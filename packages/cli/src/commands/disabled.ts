import { defineCommand } from "citty";
import { CliRuntimeError } from "../utils/commandResult.js";

/**
 * Clapova fork: commands that send data to HeyGen services (feedback, publish, cloud)
 * are disabled. The command stays listed so callers get a clear error, not "unknown command".
 */
export function disabledCommand(name: string) {
  return defineCommand({
    meta: { name, description: `Disabled in the Clapova fork (no outbound network)` },
    run() {
      throw new CliRuntimeError(`\`hyperframes ${name}\` is disabled in the Clapova fork.`, {
        exitCode: 1,
      });
    },
  });
}
