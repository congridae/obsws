export class ObsWsError extends Error {}
export class ObsWsProtoError extends ObsWsError {
	constructor(violation: string) {
		super(violation);
	}
}
export class ObsWsTimeoutError extends ObsWsError {
	constructor() {
		super("Timed out waiting for response");
	}
}
export class ObsWsRequestError extends ObsWsError {
	code: number;
	comment: string;
	constructor(code: number, comment: string) {
		super(`${code}: ${comment}`);
		this.code = code;
		this.comment = comment;
	}
}
export class ObsWsClosedError extends ObsWsError {
	constructor() {
		super("Client is closed");
	}
}
