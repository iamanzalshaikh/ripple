/** Resolved from executionContext after automation.open_project. */
export const INHERIT_PROJECT_ROOT = "__INHERIT_PROJECT_ROOT__";

export function isInheritedProjectRoot(value: unknown): boolean {
  return (
    value === "." ||
    value === INHERIT_PROJECT_ROOT ||
    value === undefined ||
    value === null ||
    value === ""
  );
}
