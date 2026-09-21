/** Every error aonia raises on purpose. `code` is stable for callers; `message` is for people. */
export class AoniaError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AoniaError";
  }
}
