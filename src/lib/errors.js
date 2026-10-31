export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what) => new HttpError(404, 'not_found', `${what} not found`);
export const forbidden = (message = 'You do not have permission to do this') =>
  new HttpError(403, 'forbidden', message);
