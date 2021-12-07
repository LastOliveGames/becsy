export class InternalError extends Error {
  constructor(message: string) {
    super(`Internal error: ${message}. Please report a bug!`);
    this.name = 'InternalError';
  }
}

export class CheckError extends Error {}
