// Quotes a value so a POSIX shell reads it back as one literal word. The value
// is wrapped in single quotes, inside which nothing is expanded, and each single
// quote in it is written as a closing quote, an escaped quote and an opening
// quote. Double quotes would still expand $(...) and backticks, so a repository
// name or URL pasted into a terminal could run commands.
export const shellQuote = (value: string): string =>
  `'${value.replaceAll("'", "'\\''")}'`;
