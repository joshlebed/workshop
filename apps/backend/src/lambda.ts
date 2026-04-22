import { handle } from "hono/aws-lambda";
import { buildApp } from "./app.js";

const app = buildApp();
export const handler = handle(app);
