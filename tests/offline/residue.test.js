import { describe, expect, it } from "vitest";
import { endsInSpace, findResidue } from "../../src/residue.js";
import { extractInlineCode } from "../../src/inline-code.js";

/** Rule ids that fire on a block whose text is all command-side. */
const rules = (code) =>
  findResidue({ kind: "shell", code, shell: { commands: [], output: [] } }).map(
    (f) => f.rule,
  );

/** Rule ids that fire on lines the reader is shown rather than told to type. */
const outputRules = (code) =>
  findResidue({ kind: "output", code, shell: null }).map((f) => f.rule);

describe("findResidue", () => {
  // Every example below is real, from
  // Integrating-SSO-and-IDPs-with-Chainguard-Registry unless noted.
  describe("the shapes a swallowed placeholder leaves", () => {
    it("finds a flag followed by two spaces", () => {
      const text = "chainctl auth pull-token --name x --parent  --ttl 30m";
      expect(rules(text)).toContain("dangling-flag");
    });

    it("finds a flag given an empty string", () => {
      expect(rules('chainctl iam identity create --username ""')).toContain(
        "empty-flag-value",
      );
    });

    it("finds a bare word followed by an empty string", () => {
      const text = 'You are about to bind identity "" to the role';
      expect(rules(text)).toContain("empty-quoted-value");
    });

    it("finds a key left with trailing space and no value", () => {
      expect(rules("jobs:\n  build:\n    identity: \n")).toContain("empty-key-value");
    });

    it("finds a flag whose value starts at a path separator", () => {
      expect(rules("--github-repo='/.*'")).toContain("eaten-before-slash");
    });

    it("finds an output line ending in a full stop with nothing before it", () => {
      const text = 'Creating role "my-example-role" under location .';
      expect(outputRules(text)).toContain("dangling-period");
    });
  });

  // This rule is scoped to output for one reason, and these are it. A
  // trailing `.` is how a build context and a copy destination are written,
  // and every one of those is a command or a Dockerfile. Unscoped, the rule
  // reported 53 sites across the content of which 2 were real.
  describe("the full-stop rule stays out of the command side", () => {
    for (const command of [
      "$ docker build -t c-distroless .",
      "$ docker build . -t example-php-image",
      "$ docker cp java-lib-example-1:/app/java-demo-app-1.0.0.jar .",
      "COPY requirements.txt .",
      "COPY --from=builder /work/target/java-demo-app-1.0.0.jar .",
    ]) {
      it(`leaves alone: ${command}`, () => {
        expect(rules(command)).not.toContain("dangling-period");
      });
    }

    it("reads the unprompted lines of a console block as output", () => {
      // The content uses both conventions, so scoping to `ansi` blocks alone
      // would only see half the output in the corpus.
      const block = {
        kind: "shell",
        code: '$ chainctl iam roles create\nCreating role "x" under location .',
        shell: {
          commands: ["chainctl iam roles create"],
          output: ['Creating role "x" under location .'],
        },
      };
      expect(findResidue(block).map((f) => f.rule)).toContain("dangling-period");
    });
  });

  describe("what it leaves alone", () => {
    // This one reached the fixture content and failed the suite. A YAML key
    // introducing nested content is correct and extremely common; the residue
    // case keeps the space that separated key from value.
    it("does not flag a YAML key that introduces nested content", () => {
      expect(rules("plugins:\n  - name: example\n")).not.toContain("empty-key-value");
    });

    it("does not flag an ordinary command", () => {
      expect(rules("$ chainctl auth login --org example.com")).toEqual([]);
    });

    it("does not flag a single space after a flag", () => {
      expect(rules("--parent example.com --ttl 30m")).not.toContain("dangling-flag");
    });

    it("does not flag a decimal or a version", () => {
      expect(rules("$ pip install requests==2.31.0")).toEqual([]);
    });

    // An empty value in a sample config is ordinary. Including `key: ""` took
    // the rule from 2 findings to 8 and added nothing real.
    it("does not flag an explicitly empty config value", () => {
      expect(rules('source: ""\nendoflife: ""')).toEqual([]);
    });

    it("does not flag an ordinary absolute path", () => {
      expect(rules('destination = "/tests"')).toEqual([]);
    });
  });

  it("reports each shape once per block, because one cause is one repair", () => {
    const text = "--parent  --ttl 30m\n--other  --more x";
    expect(rules(text)).toEqual(["dangling-flag"]);
  });

  it("quotes the line, so a finding names something recognizable", () => {
    const [found] = findResidue({
      kind: "shell",
      code: "$ chainctl auth pull-token --parent  --ttl 30m",
      shell: { commands: [], output: [] },
    });
    expect(found.line).toBe("$ chainctl auth pull-token --parent  --ttl 30m");
    expect(found.what).toBe("a long-form flag followed by two or more spaces");
  });
});

describe("endsInSpace", () => {
  it("is true for a flag left dangling", () => {
    expect(endsInSpace("--parent ")).toBe(true);
  });

  it("is false for ordinary inline code", () => {
    expect(endsInSpace("--parent")).toBe(false);
  });

  it("is false for an empty element, which is a different finding", () => {
    expect(endsInSpace("")).toBe(false);
  });
});

describe("extractInlineCode", () => {
  const texts = (html) => extractInlineCode(html, "lesson.html").map((c) => c.text);

  it("collects code in prose", () => {
    expect(texts("<p>Run <code>chainctl auth login</code> first.</p>")).toEqual([
      "chainctl auth login",
    ]);
  });

  // A block that ends in a newline has trailing whitespace and is correct, so
  // checking both populations together would mean losing the rule.
  it("ignores the code element inside a pre", () => {
    expect(texts("<pre data-lang=\"console\"><code>$ ls\n</code></pre>")).toEqual([]);
  });

  it("collects inline code alongside a block", () => {
    const html = "<pre><code>$ ls\n</code></pre><p>then <code>cd x</code></p>";
    expect(texts(html)).toEqual(["cd x"]);
  });

  it("reports the element's line", () => {
    const html = "<p>one</p>\n<p>two <code>--parent </code></p>";
    const [found] = extractInlineCode(html, "lesson.html");
    expect(found.source.line).toBe(2);
  });
});
