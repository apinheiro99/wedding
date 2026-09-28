import { describe, it, expect } from "vitest";
import {
  dedupeDecision,
  canonicalDate,
  allocatePackage,
  digestFor,
  canTransition,
  mediaKindFrom,
  formatBytes,
} from "@/server/domain/rules";

describe("dedupeDecision", () => {
  it("NEW when nothing existing", () => {
    expect(dedupeDecision(null)).toBe("NEW");
    expect(dedupeDecision(undefined)).toBe("NEW");
  });
  it("DUPLICATE_ACTIVE when existing not deleted", () => {
    expect(dedupeDecision({ deletedAt: null })).toBe("DUPLICATE_ACTIVE");
  });
  it("DUPLICATE_SOFT_DELETED when existing deleted", () => {
    expect(dedupeDecision({ deletedAt: new Date() })).toBe("DUPLICATE_SOFT_DELETED");
  });
});

describe("canonicalDate", () => {
  const upload = new Date("2024-01-01T00:00:00Z");
  it("prefers EXIF over container/clientFile/upload", () => {
    const exif = new Date("2020-01-01T00:00:00Z");
    const container = new Date("2021-01-01T00:00:00Z");
    const clientFile = new Date("2022-01-01T00:00:00Z");
    const r = canonicalDate({ exif, container, clientFile, upload });
    expect(r.source).toBe("EXIF");
    expect(r.at).toEqual(exif);
  });
  it("falls back to CONTAINER when exif invalid", () => {
    const container = new Date("2021-01-01T00:00:00Z");
    const r = canonicalDate({ exif: null, container, clientFile: new Date("2022-01-01"), upload });
    expect(r.source).toBe("CONTAINER");
  });
  it("falls back to CLIENT_FILE when exif and container invalid", () => {
    const clientFile = new Date("2022-01-01T00:00:00Z");
    const r = canonicalDate({ exif: undefined, container: undefined, clientFile, upload });
    expect(r.source).toBe("CLIENT_FILE");
  });
  it("falls back to UPLOAD when everything else invalid", () => {
    const r = canonicalDate({ upload });
    expect(r.source).toBe("UPLOAD");
    expect(r.at).toEqual(upload);
  });
  it("skips invalid dates: out-of-range year, NaN, future dates", () => {
    const tooOld = new Date("1980-01-01T00:00:00Z"); // year <= 1990
    const invalid = new Date("not-a-date");
    const future = new Date(Date.now() + 30 * 86400_000); // far future
    const clientFile = new Date("2022-01-01T00:00:00Z");
    const r = canonicalDate({ exif: tooOld, container: invalid, clientFile, upload: future });
    expect(r.source).toBe("CLIENT_FILE");
  });
});

describe("allocatePackage", () => {
  it("NEW when no last package", () => {
    expect(allocatePackage(null, 100, 1000)).toBe("NEW");
  });
  it("LAST when last package is empty regardless of size", () => {
    expect(allocatePackage({ usedBytes: 0, itemCount: 0 }, 999999, 1000)).toBe("LAST");
  });
  it("LAST when adding fits under target", () => {
    expect(allocatePackage({ usedBytes: 500, itemCount: 3 }, 400, 1000)).toBe("LAST");
  });
  it("NEW when adding exceeds target", () => {
    expect(allocatePackage({ usedBytes: 900, itemCount: 3 }, 200, 1000)).toBe("NEW");
  });
  it("LAST when exactly at target", () => {
    expect(allocatePackage({ usedBytes: 800, itemCount: 3 }, 200, 1000)).toBe("LAST");
  });
});

describe("digestFor", () => {
  it("excludes recipient's own uploads", () => {
    const acts = [
      { userId: "u1", userName: "Ana", kind: "IMAGE" as const, bytes: 100 },
      { userId: "u2", userName: "Bea", kind: "VIDEO" as const, bytes: 200 },
    ];
    const lines = digestFor("u1", acts);
    expect(lines).toHaveLength(1);
    expect(lines[0].userId).toBe("u2");
    expect(lines[0].videos).toBe(1);
  });
  it("recipient with only own activity gets empty array", () => {
    const acts = [{ userId: "u1", userName: "Ana", kind: "IMAGE" as const, bytes: 100 }];
    expect(digestFor("u1", acts)).toEqual([]);
  });
  it("aggregates counts and bytes per other user, sorted by total desc", () => {
    const acts = [
      { userId: "u2", userName: "Bea", kind: "IMAGE" as const, bytes: 10 },
      { userId: "u2", userName: "Bea", kind: "IMAGE" as const, bytes: 10 },
      { userId: "u3", userName: "Caio", kind: "VIDEO" as const, bytes: 500 },
      { userId: "u3", userName: "Caio", kind: "OTHER" as const, bytes: 5 },
      { userId: "u3", userName: "Caio", kind: "OTHER" as const, bytes: 5 },
      { userId: "u3", userName: "Caio", kind: "OTHER" as const, bytes: 5 },
    ];
    const lines = digestFor("u1", acts);
    expect(lines[0].userId).toBe("u3"); // 4 items > 2 items
    expect(lines[0].others).toBe(3);
    expect(lines[1].userId).toBe("u2");
    expect(lines[1].photos).toBe(2);
    expect(lines[1].bytes).toBe(20);
  });
});

describe("canTransition", () => {
  it("allows UPLOADING -> VERIFYING", () => {
    expect(canTransition("UPLOADING", "VERIFYING")).toBe(true);
  });
  it("allows FINALIZING -> COMPLETE/DUPLICATE/RESTORED/FAILED", () => {
    expect(canTransition("FINALIZING", "COMPLETE")).toBe(true);
    expect(canTransition("FINALIZING", "DUPLICATE")).toBe(true);
    expect(canTransition("FINALIZING", "RESTORED")).toBe(true);
    expect(canTransition("FINALIZING", "FAILED")).toBe(true);
  });
  it("rejects transitions out of terminal states", () => {
    expect(canTransition("COMPLETE", "UPLOADING")).toBe(false);
    expect(canTransition("FAILED", "VERIFYING")).toBe(false);
  });
  it("rejects invalid jumps", () => {
    expect(canTransition("UPLOADING", "COMPLETE")).toBe(false);
    expect(canTransition("VERIFYING", "COMPLETE")).toBe(false);
  });
});

describe("mediaKindFrom", () => {
  it("uses mime when present", () => {
    expect(mediaKindFrom("image/jpeg", "file.bin")).toBe("IMAGE");
    expect(mediaKindFrom("video/mp4", "file.bin")).toBe("VIDEO");
  });
  it("falls back to extension when mime missing", () => {
    expect(mediaKindFrom(null, "IMG_001.HEIC")).toBe("IMAGE");
    expect(mediaKindFrom(undefined, "clip.mov")).toBe("VIDEO");
  });
  it("returns OTHER for unknown extension/mime", () => {
    expect(mediaKindFrom("application/pdf", "doc.pdf")).toBe("OTHER");
    expect(mediaKindFrom(null, "noext")).toBe("OTHER");
  });
});

describe("formatBytes", () => {
  it("formats bytes below 1024 as B", () => {
    expect(formatBytes(500)).toBe("500 B");
  });
  it("formats larger sizes with unit using comma decimal", () => {
    expect(formatBytes(1024)).toBe("1,0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1,0 MB");
  });
});
