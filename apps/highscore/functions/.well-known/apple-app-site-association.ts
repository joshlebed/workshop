/** Apple App Site Association document for HighScore Universal Links. */
const APP_ID = "Q65U6C65ZZ.live.highscore.app";

const AASA = {
  applinks: {
    details: [
      {
        appIDs: [APP_ID],
        components: [{ "/": "/g/*" }, { "/": "/friends/accept/*" }],
      },
    ],
  },
} as const;

export const onRequestGet = (): Response =>
  new Response(JSON.stringify(AASA), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=3600",
    },
  });
