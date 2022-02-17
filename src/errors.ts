export class InternalError extends Error {
  constructor(message: string) {
    super(`Internal error: ${message}. Please report a bug!`);
  }
}

export class CheckError extends Error {}
