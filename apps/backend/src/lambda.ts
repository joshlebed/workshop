import { handle } from "hono/aws-lambda";
import { buildApp } from "./app.js";
import { warmGameCodeSandboxIfEnabled } from "./lib/gameCodeService.js";

const app = buildApp();
// Init runs at full CPU; a request runs at a fraction of a vCPU. See the
// function's comment for why this is a no-op while GAME_CODE_PARSING is off.
warmGameCodeSandboxIfEnabled();
export const handler = handle(app);
