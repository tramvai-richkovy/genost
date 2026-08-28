import { describe, expect, it } from "vitest";
import { isAbsoluteAssetPath, isUriAssetPath, resolveProjectAssetPath } from "./paths";

describe("audio asset path helpers", () => {
  it("resolves project-relative asset paths against the loaded project folder", () => {
    expect(resolveProjectAssetPath("/Users/me/Tracks/Song", "STEMS/pad.wav")).toBe(
      "/Users/me/Tracks/Song/STEMS/pad.wav",
    );
    expect(resolveProjectAssetPath("/Users/me/Tracks/Song/", "./MIXES/final.mp3")).toBe(
      "/Users/me/Tracks/Song/MIXES/final.mp3",
    );
  });

  it("keeps absolute paths and URI paths unchanged", () => {
    expect(resolveProjectAssetPath("/project", "/Volumes/Audio/stem.wav")).toBe("/Volumes/Audio/stem.wav");
    expect(resolveProjectAssetPath("/project", "file:///Volumes/Audio/stem.wav")).toBe(
      "file:///Volumes/Audio/stem.wav",
    );
    expect(resolveProjectAssetPath("/project", "C:\\Audio\\stem.wav")).toBe("C:\\Audio\\stem.wav");
    expect(isAbsoluteAssetPath("/Volumes/Audio/stem.wav")).toBe(true);
    expect(isUriAssetPath("asset://localhost/file.wav")).toBe(true);
    expect(isUriAssetPath("C:\\Audio\\stem.wav")).toBe(false);
  });

  it("does not invent a path for relative assets without a project folder", () => {
    expect(resolveProjectAssetPath(null, "STEMS/pad.wav")).toBeNull();
    expect(resolveProjectAssetPath("", "STEMS/pad.wav")).toBeNull();
  });
});
