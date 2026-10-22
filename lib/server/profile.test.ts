import { describe, it, expect } from "vitest";
import { paginateByCursor, PROFILE_PAGE_SIZE } from "./profile";

interface Row {
  claimId: number;
}

const rows: Row[] = Array.from({ length: 45 }, (_, i) => ({ claimId: 45 - i }));
const key = (row: Row) => row.claimId;

describe("paginateByCursor", () => {
  it("returns the first page when no cursor is given", () => {
    const page = paginateByCursor(rows, null, PROFILE_PAGE_SIZE, key);
    expect(page.items).toHaveLength(20);
    expect(page.items[0].claimId).toBe(45);
    expect(page.items[19].claimId).toBe(26);
    expect(page.nextCursor).toBe("26");
  });

  it("slices stably from the cursor", () => {
    const page = paginateByCursor(rows, "26", PROFILE_PAGE_SIZE, key);
    expect(page.items).toHaveLength(20);
    expect(page.items[0].claimId).toBe(25);
    expect(page.items[19].claimId).toBe(6);
    expect(page.nextCursor).toBe("6");
  });

  it("returns a shorter last page with no next cursor", () => {
    const page = paginateByCursor(rows, "6", PROFILE_PAGE_SIZE, key);
    expect(page.items).toHaveLength(5);
    expect(page.items[4].claimId).toBe(2);
    expect(page.nextCursor).toBeNull();
  });

  it("returns an empty page past the end", () => {
    const page = paginateByCursor(rows, "1", PROFILE_PAGE_SIZE, key);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("falls back to the first page on a malformed cursor", () => {
    const page = paginateByCursor(rows, "not-a-number", PROFILE_PAGE_SIZE, key);
    expect(page.items[0].claimId).toBe(45);
    expect(page.nextCursor).toBe("26");
  });

  it("produces the same slice for the same cursor", () => {
    const a = paginateByCursor(rows, "26", PROFILE_PAGE_SIZE, key);
    const b = paginateByCursor(
      [...rows, ...rows.map((row) => ({ claimId: row.claimId - 100 }))],
      "26",
      PROFILE_PAGE_SIZE,
      key,
    );
    expect(a.items).toEqual(b.items);
    expect(a.nextCursor).toBe(b.nextCursor);
  });
});
