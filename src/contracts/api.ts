export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_REPOSITORY"
  | "REPOSITORY_NOT_FOUND"
  | "ISSUES_DISABLED_OR_EMPTY"
  | "GITHUB_RATE_LIMITED"
  | "GITHUB_UNAVAILABLE"
  | "UNAUTHORIZED_EDIT"
  | "RUN_NOT_READY"
  | "INTERNAL_ERROR";

export interface ApiErrorPayload {
  error: {
    code: ApiErrorCode;
    message: string;
    retryable: boolean;
    requestId: string;
  };
}

export interface ApiSuccessPayload<T> {
  data: T;
}
