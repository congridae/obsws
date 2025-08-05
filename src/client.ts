import {
	ObsWsClosedError,
	ObsWsError,
	ObsWsProtoError,
	ObsWsRequestError,
	ObsWsTimeoutError,
} from "./errors.ts";
import type { ObsEvent } from "./events.ts";
import type { ObsRequest } from "./requests.ts";
import { ObsConfig } from "./wrappers/config.ts";
import { ObsFilters } from "./wrappers/filters.ts";
import { ObsGeneral } from "./wrappers/general.ts";
import { ObsInputs } from "./wrappers/inputs.ts";
import { ObsMediaInputs } from "./wrappers/media-inputs.ts";
import { ObsOutputs } from "./wrappers/outputs.ts";
import { ObsRecord } from "./wrappers/record.ts";
import { ObsSceneItems } from "./wrappers/scene-items.ts";
import { ObsScenes } from "./wrappers/scenes.ts";
import { ObsSources } from "./wrappers/sources.ts";
import { ObsStream } from "./wrappers/stream.ts";
import { ObsTransitions } from "./wrappers/transitions.ts";
import { ObsUi } from "./wrappers/ui.ts";

const Resend = Symbol();
const Timeout = Symbol();
const Closed = Symbol();

export class ObsWs {
	private port: number;
	private password: string | undefined;
	private onError: (err: Error) => void;
	private ws: WebSocket | undefined;
	private connReady: (() => void)[] | undefined;
	private inflight: Map<number, (data: unknown) => void>;
	private retryCooldown: number;
	private stage: number;
	private counter: number;
	private requestTimeout: number;
	private closed: boolean;
	private subscriptionMask: number;
	// shhhhhush your little mouth
	// deno-lint-ignore no-explicit-any
	private subscriptions: [string, (event: any) => void][];

	constructor(
		{ port, password, onError, retryCooldown, requestTimeout }: {
			port: number;
			password?: string;
			onError?: (err: Error) => void;
			retryCooldown?: number;
			requestTimeout?: number;
		},
	) {
		this.port = port;
		this.password = password;
		this.onError = onError ?? ((err) => {
			throw err;
		});
		this.inflight = new Map();
		this.retryCooldown = retryCooldown ?? 1_000;
		this.requestTimeout = requestTimeout ?? 30_000;
		this.counter = 0;
		this.closed = false;
		this.subscriptionMask = 0;
		this.subscriptions = [];
		this.stage = 0;
		this.connect();
	}

	private connect() {
		if (this.closed) return;
		if (!this.connReady) {
			this.connReady = [];
		}
		this.stage = 0;
		if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.close();
		this.ws = new WebSocket(
			`ws://localhost:${this.port}`,
			"obswebsocket.json",
		);
		let errored = false;
		this.ws.onclose = (ev) => {
			if (ev.code === 4009) {
				this.close();
				return this.onError(new ObsWsError("Incorrect password"));
			}
			if (!errored) this.connect();
		};
		this.ws.onerror = (err) => {
			this.onError((err as ErrorEvent).error);
			errored = true;
			setTimeout(() => this.connect(), this.retryCooldown);
		};
		this.ws.onmessage = (ev) => {
			const { op, d } = JSON.parse(ev.data);
			this.handleMessage(op, d);
		};
	}

	private handleMessage(op: number, data: unknown) {
		if (this.stage === 0 && op !== OpCode.Hello) { // didn't say hello, how impolite!
			this.onError(
				new ObsWsProtoError("First received message was not Hello"),
			);
			return this.connect();
		}
		if (this.stage === 1 && op !== OpCode.Identified) {
			this.onError(
				new ObsWsProtoError("Response to Identify was not Identified"),
			);
			return this.connect();
		}
		switch (op) {
			case (OpCode.Hello): {
				if (this.stage !== 0) { // saying hello twice is also impolite i guess
					this.onError(new ObsWsProtoError("Received Hello twice"));
					return this.connect();
				}
				const { authentication } = data as HelloMsg;
				if (authentication && !this.password) {
					this.close();
					return this.onError(
						new ObsWsError(
							"OBS configured with password but no password given",
						),
					);
				}
				const ws = this.ws!;
				(async () => {
					const identify: IdentifyMsg = {
						rpcVersion: 1,
						eventSubscriptions: this.subscriptionMask,
					};
					if (authentication) {
						identify.authentication = await buildAuth(
							this.password!,
							authentication.challenge,
							authentication.salt,
						);
					}
					if (ws.readyState !== WebSocket.OPEN) return; // connection dropped while processing
					ws.send(JSON.stringify({
						op: OpCode.Identify,
						d: identify,
					}));
					this.stage = 1;
				})();
				break;
			}
			case (OpCode.Identified): {
				if (this.stage !== 1) return; // in response to a Reidentify
				this.stage = 2;
				// resend any requests that were dropped
				const inflight = this.inflight;
				this.inflight = new Map();
				inflight.forEach((callback) => callback(Resend));
				// wake anyone waiting for the connection
				const waiters = this.connReady!;
				this.connReady = undefined;
				for (const waiter of waiters) {
					waiter();
				}
				break;
			}
			case (OpCode.Event): {
				const { eventType, eventData } = data as EventMsg;
				for (const [type, callback] of this.subscriptions) {
					if (type === eventType) callback(eventData);
				}
				break;
			}
			case (OpCode.RequestResponse): {
				const { requestId } = data as RequestResponseMsg;
				const callback = this.inflight.get(requestId);
				if (callback) {
					this.inflight.delete(requestId);
					callback(data);
				}
			}
		}
	}

	/** Permanently close the connection */
	close() {
		if (this.closed) return;
		this.closed = true;
		this.ws!.onclose = null;
		this.ws!.onerror = null;
		this.ws!.onmessage = null;
		this.ws!.close();
		this.inflight.forEach((callback) => callback(Closed));
	}

	async call<RequestData, ResponseData>(
		request: ObsRequest<RequestData, ResponseData>,
		data: RequestData,
	): Promise<ResponseData> {
		if (this.closed) throw new ObsWsClosedError();
		let response: unknown;
		while (true) {
			// wait for valid connection
			while (this.connReady !== undefined) {
				await new Promise((resolve) =>
					this.connReady!.push(resolve as () => void)
				);
			}
			const nonce = this.counter++;
			this.ws!.send(JSON.stringify({
				op: OpCode.Request,
				d: {
					requestType: request.type,
					requestId: nonce,
					requestData: data,
				} as RequestMsg,
			}));
			const result = await new Promise((resolve) => {
				const timeout = setTimeout(() => resolve(Timeout), this.requestTimeout);
				this.inflight.set(nonce, (data) => {
					clearTimeout(timeout);
					resolve(data);
				});
			});
			if (result === Timeout) {
				throw new ObsWsTimeoutError();
			}
			if (result === Resend) {
				continue; // connection dropped, resend
			}
			if (result === Closed) {
				throw new ObsWsClosedError();
			}
			response = result;
			break;
		}
		const { requestStatus, responseData } = response as RequestResponseMsg;
		if (!requestStatus.result) {
			throw new ObsWsRequestError(requestStatus.code, requestStatus.comment);
		}

		return responseData as ResponseData;
	}

	async subscribe<EventBody>(
		event: ObsEvent<EventBody>,
		callback: (ev: EventBody) => void,
	): Promise<void> {
		if (this.closed) throw new ObsWsClosedError();
		this.subscriptions.push([event.type, callback]);
		if ((this.subscriptionMask & event.mask) === 0) {
			// need to add new subscription
			// wait for valid connection
			while (this.connReady !== undefined) {
				await new Promise((resolve) =>
					this.connReady!.push(resolve as () => void)
				);
			}
			if ((this.subscriptionMask & event.mask) !== 0) {
				return; // someone already subscribed to this mask while we were waiting
			}
			// even if Reidentify gets dropped, new connection will be established with new mask
			this.subscriptionMask |= event.mask;
			this.ws!.send(JSON.stringify({
				op: OpCode.Reidentify,
				d: {
					eventSubscriptions: this.subscriptionMask,
				} as ReidentifyMsg,
			}));
		}
	}

	// wrappers
	private _scenes?: ObsScenes;
	get scenes(): ObsScenes {
		if (this._scenes) return this._scenes;
		return this._scenes = new ObsScenes(this);
	}

	private _config?: ObsConfig;
	get config(): ObsConfig {
		if (this._config) return this._config;
		return this._config = new ObsConfig(this);
	}

	private _transitions?: ObsTransitions;
	get transitions(): ObsTransitions {
		if (this._transitions) return this._transitions;
		return this._transitions = new ObsTransitions(this);
	}

	private _general?: ObsGeneral;
	get general(): ObsGeneral {
		if (this._general) return this._general;
		return this._general = new ObsGeneral(this);
	}

	private _inputs?: ObsInputs;
	get inputs(): ObsInputs {
		if (this._inputs) return this._inputs;
		return this._inputs = new ObsInputs(this);
	}

	private _mediaInputs?: ObsMediaInputs;
	get mediaInputs(): ObsMediaInputs {
		if (this._mediaInputs) return this._mediaInputs;
		return this._mediaInputs = new ObsMediaInputs(this);
	}

	private _outputs?: ObsOutputs;
	get outputs(): ObsOutputs {
		if (this._outputs) return this._outputs;
		return this._outputs = new ObsOutputs(this);
	}

	private _sceneItems?: ObsSceneItems;
	get sceneItems(): ObsSceneItems {
		if (this._sceneItems) return this._sceneItems;
		return this._sceneItems = new ObsSceneItems(this);
	}

	private _ui?: ObsUi;
	get ui(): ObsUi {
		if (this._ui) return this._ui;
		return this._ui = new ObsUi(this);
	}

	private _filters?: ObsFilters;
	get filters(): ObsFilters {
		if (this._filters) return this._filters;
		return this._filters = new ObsFilters(this);
	}

	private _record?: ObsRecord;
	get record(): ObsRecord {
		if (this._record) return this._record;
		return this._record = new ObsRecord(this);
	}

	private _sources?: ObsSources;
	get sources(): ObsSources {
		if (this._sources) return this._sources;
		return this._sources = new ObsSources(this);
	}

	private _stream?: ObsStream;
	get stream(): ObsStream {
		if (this._stream) return this._stream;
		return this._stream = new ObsStream(this);
	}
}

const OpCode = {
	Hello: 0,
	Identify: 1,
	Identified: 2,
	Reidentify: 3,
	Event: 5,
	Request: 6,
	RequestResponse: 7,
	RequestBatch: 8,
	RequestBatchResponse: 9,
} as const;

type HelloMsg = {
	authentication?: {
		challenge: string;
		salt: string;
	};
};

type IdentifyMsg = {
	rpcVersion: number;
	authentication?: string;
	eventSubscriptions?: number;
};

type ReidentifyMsg = {
	eventSubscriptions: number;
};

type EventMsg = {
	eventType: string;
	eventData: unknown;
};

type RequestMsg = {
	requestType: string;
	requestId: number;
	requestData?: string;
};

type RequestResponseMsg = {
	requestType: string;
	requestId: number;
	requestStatus: {
		result: true;
		code: number;
	} | {
		result: false;
		code: number;
		comment: string;
	};
	responseData?: unknown;
};

async function buildAuth(
	password: string,
	challenge: string,
	salt: string,
): Promise<string> {
	const secret = await sha256Base64(`${password}${salt}`);
	const auth = await sha256Base64(`${secret}${challenge}`);
	return auth;
}

async function sha256Base64(data: string) {
	const hash = await crypto.subtle.digest(
		{ name: "SHA-256" },
		new TextEncoder().encode(data),
	);
	return btoa(String.fromCharCode(...new Uint8Array(hash)));
}
