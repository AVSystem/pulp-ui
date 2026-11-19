// The schema files that generation reads, relative to the package root.
//
// Every entry is merged by the same transformer before any client is
// generated: a component that two sources define differently stops
// generation, and so does a path that no application claims. Adding the
// schema of another plugin release is one more entry here, not another
// generation path.
export const SCHEMA_SOURCES = ['schema/pulp.json'];
