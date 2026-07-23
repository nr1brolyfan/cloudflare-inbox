/** Whether a sensitive control-plane mutation is known to have committed. */
export type AccountSecurityCommitState =
  | "not-committed"
  | "committed"
  | "unknown";
