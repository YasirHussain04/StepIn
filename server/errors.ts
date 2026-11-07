export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public stage?: string,
  ) {
    super(message);
  }
}
export function unavailable(stage: string) {
  return new ApiError(
    "SERVICE_UNAVAILABLE",
    `${stage} is not configured. You can explicitly switch to offline demo mode.`,
    503,
    stage,
  );
}
