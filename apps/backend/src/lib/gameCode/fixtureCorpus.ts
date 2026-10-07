// Test helper: every string literal in the legacy parser / formatter test
// files, used as the input corpus for the parity tests. Reading the fixtures
// out of the test sources (instead of copying them) means a share added to
// one of those files is automatically checked against the stored code too.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO_ROOT = fileURLToPath(new URL("../../../../..", import.meta.url));

const FIXTURE_FILES = [
  "packages/shared/src/gameRegistry.test.ts",
  "packages/shared/src/scoreParsing.test.ts",
  "packages/shared/src/summarySpec.test.ts",
  "apps/highscore/src/games/lib/scoresSummary.test.ts",
];

/** The literal text of a node, folding `"a" + "b"` concatenations. */
function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return literalText(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literalText(node.left);
    const right = literalText(node.right);
    return left !== null && right !== null ? left + right : null;
  }
  return null;
}

function literalsIn(file: string): string[] {
  const path = resolve(REPO_ROOT, file);
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    // Module specifiers are not fixtures.
    if (ts.isImportDeclaration(node)) return;
    const text = literalText(node);
    if (text !== null) found.push(text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * Distinct string literals from the fixture files that could be a share
 * text: long enough to carry a result, short enough to be accepted.
 */
export function fixtureCorpus(): string[] {
  const all = FIXTURE_FILES.flatMap(literalsIn);
  return [...new Set(all)].filter((text) => text.trim().length >= 3 && text.length <= 2000);
}
