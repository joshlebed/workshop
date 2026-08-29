# FROZEN — deleted at Wave-4 cutover (PR-10)

This directory is the Workshop legacy Games UI snapshot. Only deliberate critical-fix backports
are allowed. Product, style, layout, branding, and client-behavior iteration belongs in
`apps/highscore/src/games/` and must not be copied here.

Workshop's `app/friends/*` routes are a shared-product surface and live outside this directory.
Their temporary game panels import this snapshot so PR-10 can remove those integrations while
retaining the friends graph and routes.
