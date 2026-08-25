import { describe, expect, it } from "vitest";
import { hasCommandPrompt, splitShell } from "../../src/classify.js";

describe("spotting a command inside a block labelled as output", () => {
  it("catches a decorated prompt", () => {
    expect(hasCommandPrompt("❯ docker pull cgr.dev/chainguard/node")).toBe(true);
    expect(hasCommandPrompt("➜  ~ grype pytorch/pytorch")).toBe(true);
  });

  it("catches a command partway through a transcript", () => {
    expect(hasCommandPrompt("Loaded image\n❯ docker pull nginx\nUsing tag")).toBe(
      true,
    );
  });

  it("passes ordinary output", () => {
    expect(hasCommandPrompt("Using default tag: latest\nPull complete")).toBe(false);
  });

  /**
   * A lesson that shows the bare prompt a tool hands back is displaying
   * output. Flagging it would send an author looking for a command that is
   * not there.
   */
  it("passes a bare prompt with no command after it", () => {
    expect(hasCommandPrompt("#")).toBe(false);
    expect(hasCommandPrompt("$")).toBe(false);
    expect(hasCommandPrompt("nginx:/#")).toBe(false);
  });
});

describe("splitting a shell block on its prompt", () => {
  it("takes the $ prompt used through most of the content", () => {
    const { commands, hasPrompt } = splitShell("$ docker pull nginx");
    expect(hasPrompt).toBe(true);
    expect(commands).toEqual(["docker pull nginx"]);
  });

  it("separates interleaved output from the commands", () => {
    const { commands, output } = splitShell(
      ["$ echo hi", "hi", "$ echo bye", "bye"].join("\n"),
    );
    expect(commands).toEqual(["echo hi", "echo bye"]);
    expect(output).toEqual(["hi", "bye"]);
  });

  it("joins a command continued across backslashes", () => {
    const { commands } = splitShell("$ docker run \\\n  --rm \\\n  nginx");
    expect(commands).toEqual(["docker run \\\n  --rm \\\n  nginx"]);
  });

  /**
   * The debugging lessons attach an ephemeral container and then show the
   * container's own prompt, which tells the reader the command runs inside the
   * target rather than on their machine. Reading that as promptless would ask
   * an author to replace a meaningful prompt with a generic one.
   */
  describe("prompts that name the host or container", () => {
    it("recognizes a container prompt", () => {
      const { commands, hasPrompt } = splitShell("nginx:/# ps aux");
      expect(hasPrompt).toBe(true);
      expect(commands).toEqual(["ps aux"]);
    });

    it("recognizes a user@host prompt", () => {
      const { commands, hasPrompt } = splitShell("root@builder:~$ apk add curl");
      expect(hasPrompt).toBe(true);
      expect(commands).toEqual(["apk add curl"]);
    });

    it("splits a container session into commands and output", () => {
      const { commands, output } = splitShell(
        ["nginx:/# ps aux", "PID   USER     TIME  COMMAND", "    1 65532  nginx"].join(
          "\n",
        ),
      );
      expect(commands).toEqual(["ps aux"]);
      expect(output).toHaveLength(2);
    });

    it("does not mistake an indented output line for a prompt", () => {
      const { commands } = splitShell(
        ["$ ls", "total 0", "drwxr-xr-x  2 root root 40 Jan  1 00:00 ."].join("\n"),
      );
      expect(commands).toEqual(["ls"]);
    });
  });

  /**
   * A block opening with a shebang is a file the reader saves, so it has no
   * prompt by design. Splitting it would also turn its comment lines into
   * commands, since they start with `#`.
   */
  describe("script files", () => {
    const script = [
      "#!/usr/bin/env bash",
      "",
      "# Build the image",
      "IMAGE_NAME=nginx-test",
      "docker build -t $IMAGE_NAME .",
    ].join("\n");

    it("marks the block as a script", () => {
      expect(splitShell(script).script).toBe(true);
    });

    it("keeps the script whole rather than splitting it", () => {
      expect(splitShell(script).commands).toEqual([script]);
    });

    it("does not claim the script has a prompt", () => {
      expect(splitShell(script).hasPrompt).toBe(false);
    });

  });

  /**
   * `#` is the root prompt in principle, but in this content it always opens a
   * comment. Reading those as commands invents steps a reader never runs.
   */
  describe("comments", () => {
    it("does not turn a comment into a command", () => {
      const { commands } = splitShell("# Install (macOS)\n$ brew install chainctl");
      expect(commands).toEqual(["brew install chainctl"]);
    });

    it("does not count a comment as output", () => {
      const { output } = splitShell("# Log in\n$ chainctl auth login");
      expect(output).toEqual([]);
    });

    it("still sees the block as prompted", () => {
      expect(splitShell("# Install\n$ brew install chainctl").hasPrompt).toBe(true);
    });

    it("keeps a root prompt that names its host", () => {
      expect(splitShell("nginx:/# ps aux").commands).toEqual(["ps aux"]);
    });
  });
});
