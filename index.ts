import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

import { xmtpPlugin } from "./src/channel.js";
import { setXmtpRuntime } from "./src/runtime.js";

const plugin = {
  id: "xmtp",
  name: "XMTP",
  description: "XMTP Web3 messaging channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setXmtpRuntime(api.runtime);
    api.registerChannel({ plugin: xmtpPlugin });
    api.logger.info("XMTP channel plugin registered");
  },
};

export default plugin;
