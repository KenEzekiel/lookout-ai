module.exports = {
  forbidden: [
    {
      name: "no-cycles",
      severity: "error",
      from: { pathNot: "^apps/app/src/routeTree\\.gen\\.ts$" },
      to: { circular: true, pathNot: "^apps/app/src/routeTree\\.gen\\.ts$" },
    },
    {
      name: "no-unresolved",
      severity: "error",
      from: {},
      to: { couldNotResolve: true, pathNot: "\\?url$" },
    },
    {
      name: "no-production-test-imports",
      severity: "error",
      from: { path: "^apps/app/src/" },
      to: { path: "(^|/)(tests|__tests__)/|\\.(test|spec)\\.[cm]?[jt]sx?$" },
    },
    {
      name: "shared-code-is-independent",
      severity: "error",
      from: { path: "^apps/app/src/lib/" },
      to: { path: "^apps/app/src/(routes|components|server)/" },
    },
    {
      name: "components-do-not-import-routes-or-server",
      severity: "error",
      from: { path: "^apps/app/src/components/" },
      to: { path: "^apps/app/src/(routes|server)/" },
    },
    {
      name: "server-does-not-import-ui",
      severity: "error",
      from: { path: "^apps/app/src/server/" },
      to: { path: "^apps/app/src/(routes|components)/" },
    },
    {
      name: "worker-bindings-stay-on-server",
      severity: "error",
      from: { path: "^apps/app/src/", pathNot: "^apps/app/src/server/" },
      to: { path: "^cloudflare:" },
    },
    {
      name: "no-undeclared-dependencies",
      severity: "error",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "apps/app/tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      conditionNames: ["import", "node", "default"],
      exportsFields: ["exports"],
    },
  },
};
