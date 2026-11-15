import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { queryClient } from "@/lib/queryClient";
import { useDbStore } from "@/stores/dbStore";
import { useUiStore } from "@/stores/uiStore";

vi.mock("@/utils/api", () => ({ dbLock: vi.fn() }));

import { dbLock } from "@/utils/api";
import { lockSession } from "@/utils/session";

const mockedLock = vi.mocked(dbLock);

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  queryClient.setQueryData(["accounts"], [{ id: "a1" }]);
  useDbStore.setState({ isUnlocked: true });
  useUiStore.setState({ quickAddOpen: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lockSession", () => {
  it("drops the key, the cache and the in-flight quick-add form", async () => {
    mockedLock.mockResolvedValue(undefined);

    await expect(lockSession()).resolves.toBe(true);

    expect(mockedLock).toHaveBeenCalledTimes(1);
    expect(useDbStore.getState().isUnlocked).toBe(false);
    expect(useUiStore.getState().quickAddOpen).toBe(false);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("skips the backend when the ledger is already locked", async () => {
    useDbStore.setState({ isUnlocked: false });

    await expect(lockSession()).resolves.toBe(true);

    expect(mockedLock).not.toHaveBeenCalled();
    expect(useDbStore.getState().isUnlocked).toBe(false);
  });

  it("retries once before reporting a dropped failure", async () => {
    mockedLock
      .mockRejectedValueOnce(new Error("transport"))
      .mockResolvedValueOnce(undefined);

    await expect(lockSession()).resolves.toBe(true);
    expect(mockedLock).toHaveBeenCalledTimes(2);
  });

  it("reports false when the key cannot be dropped, but still clears the UI", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedLock.mockRejectedValue(new Error("key refuses to go"));

    await expect(lockSession()).resolves.toBe(false);

    expect(mockedLock).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalled();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(useDbStore.getState().isUnlocked).toBe(false);
  });
});
