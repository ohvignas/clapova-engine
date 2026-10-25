// Machine entrypoint: `node dist/bin.js`. Exit code 0 only when every chunk is uploaded.
import { main } from "./worker.js";

main().then(
  () => process.exit(0),
  (err) => {
    console.error(
      `[clapova-fly] worker failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  },
);
