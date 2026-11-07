import { builtinEnvironments } from "vitest/runtime";

export default {
  ...builtinEnvironments.jsdom,
  async setup(...args: Parameters<typeof builtinEnvironments.jsdom.setup>) {
    const [global] = args;
    const transport = {
      Blob: global.Blob,
      File: global.File,
      FormData: global.FormData,
      Request: global.Request,
      Response: global.Response,
    };
    const environment = await builtinEnvironments.jsdom.setup(...args);
    Object.assign(global, transport);
    return environment;
  },
};
