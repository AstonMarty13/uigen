import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// --- Mocks ---

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockSignInAction = vi.fn();
const mockSignUpAction = vi.fn();
vi.mock("@/actions", () => ({
  signIn: (...args: unknown[]) => mockSignInAction(...args),
  signUp: (...args: unknown[]) => mockSignUpAction(...args),
}));

const mockGetAnonWorkData = vi.fn();
const mockClearAnonWork = vi.fn();
vi.mock("@/lib/anon-work-tracker", () => ({
  getAnonWorkData: () => mockGetAnonWorkData(),
  clearAnonWork: () => mockClearAnonWork(),
}));

const mockGetProjects = vi.fn();
vi.mock("@/actions/get-projects", () => ({
  getProjects: () => mockGetProjects(),
}));

const mockCreateProject = vi.fn();
vi.mock("@/actions/create-project", () => ({
  createProject: (...args: unknown[]) => mockCreateProject(...args),
}));

// Import after mocks
const { useAuth } = await import("@/hooks/use-auth");

// --- Helpers ---

const SUCCESS = { success: true };
const FAILURE = { success: false, error: "Invalid credentials" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAnonWorkData.mockReturnValue(null);
  mockGetProjects.mockResolvedValue([]);
  mockCreateProject.mockResolvedValue({ id: "new-project-id" });
});

// --- Tests ---

describe("useAuth", () => {
  test("exposes signIn, signUp, and isLoading=false initially", () => {
    const { result } = renderHook(() => useAuth());

    expect(result.current.isLoading).toBe(false);
    expect(typeof result.current.signIn).toBe("function");
    expect(typeof result.current.signUp).toBe("function");
  });

  // ── signIn ──────────────────────────────────────────────────────────────

  describe("signIn()", () => {
    describe("on success", () => {
      beforeEach(() => {
        mockSignInAction.mockResolvedValue(SUCCESS);
      });

      test("navigates to most recent project when user has projects and no anon work", async () => {
        mockGetProjects.mockResolvedValue([{ id: "proj-1" }, { id: "proj-2" }]);

        const { result } = renderHook(() => useAuth());
        await act(async () => {
          await result.current.signIn("user@example.com", "password123");
        });

        expect(mockPush).toHaveBeenCalledWith("/proj-1");
      });

      test("creates a new project and navigates when user has no projects and no anon work", async () => {
        mockGetProjects.mockResolvedValue([]);
        mockCreateProject.mockResolvedValue({ id: "brand-new" });

        const { result } = renderHook(() => useAuth());
        await act(async () => {
          await result.current.signIn("user@example.com", "password123");
        });

        expect(mockCreateProject).toHaveBeenCalledWith(
          expect.objectContaining({ messages: [], data: {} })
        );
        expect(mockPush).toHaveBeenCalledWith("/brand-new");
      });

      test("migrates anon work into a new project and navigates when messages exist", async () => {
        const anonWork = {
          messages: [{ role: "user", content: "Make a button" }],
          fileSystemData: { "/": { type: "directory" }, "/App.tsx": { content: "..." } },
        };
        mockGetAnonWorkData.mockReturnValue(anonWork);
        mockCreateProject.mockResolvedValue({ id: "migrated-project" });

        const { result } = renderHook(() => useAuth());
        await act(async () => {
          await result.current.signIn("user@example.com", "password123");
        });

        expect(mockCreateProject).toHaveBeenCalledWith({
          name: expect.stringMatching(/^Design from /),
          messages: anonWork.messages,
          data: anonWork.fileSystemData,
        });
        expect(mockClearAnonWork).toHaveBeenCalledTimes(1);
        expect(mockGetProjects).not.toHaveBeenCalled();
        expect(mockPush).toHaveBeenCalledWith("/migrated-project");
      });

      test("skips anon work migration when messages array is empty", async () => {
        mockGetAnonWorkData.mockReturnValue({ messages: [], fileSystemData: {} });
        mockGetProjects.mockResolvedValue([{ id: "existing" }]);

        const { result } = renderHook(() => useAuth());
        await act(async () => {
          await result.current.signIn("user@example.com", "password123");
        });

        expect(mockCreateProject).not.toHaveBeenCalled();
        expect(mockClearAnonWork).not.toHaveBeenCalled();
        expect(mockPush).toHaveBeenCalledWith("/existing");
      });

      test("returns the server action result", async () => {
        mockGetProjects.mockResolvedValue([{ id: "p" }]);

        const { result } = renderHook(() => useAuth());
        let returnValue: unknown;
        await act(async () => {
          returnValue = await result.current.signIn("u@test.com", "pass");
        });

        expect(returnValue).toEqual(SUCCESS);
      });

      test("calls signInAction with provided credentials", async () => {
        mockGetProjects.mockResolvedValue([{ id: "p" }]);

        const { result } = renderHook(() => useAuth());
        await act(async () => {
          await result.current.signIn("hello@world.com", "hunter2");
        });

        expect(mockSignInAction).toHaveBeenCalledWith("hello@world.com", "hunter2");
      });
    });

    describe("on failure", () => {
      beforeEach(() => {
        mockSignInAction.mockResolvedValue(FAILURE);
      });

      test("does not navigate when sign-in fails", async () => {
        const { result } = renderHook(() => useAuth());
        await act(async () => {
          await result.current.signIn("bad@user.com", "wrongpass");
        });

        expect(mockPush).not.toHaveBeenCalled();
        expect(mockGetProjects).not.toHaveBeenCalled();
      });

      test("returns the failure result", async () => {
        const { result } = renderHook(() => useAuth());
        let returnValue: unknown;
        await act(async () => {
          returnValue = await result.current.signIn("bad@user.com", "wrongpass");
        });

        expect(returnValue).toEqual(FAILURE);
      });
    });

    describe("isLoading", () => {
      test("is false before any call", () => {
        const { result } = renderHook(() => useAuth());
        expect(result.current.isLoading).toBe(false);
      });

      test("is true during call and resets to false on success", async () => {
        // Use a manually-controlled promise so the action stays pending
        // long enough for us to observe isLoading = true
        let resolveAction!: (v: unknown) => void;
        mockSignInAction.mockImplementation(
          () => new Promise((r) => { resolveAction = r; })
        );
        mockGetProjects.mockResolvedValue([{ id: "x" }]);

        const { result } = renderHook(() => useAuth());

        // Start signIn but exit act before resolving the action.
        // setIsLoading(true) runs synchronously before the first await,
        // so it will be flushed when this act block completes.
        let callPromise: Promise<unknown>;
        await act(async () => {
          callPromise = result.current.signIn("u@e.com", "pass");
          await Promise.resolve(); // let React flush setIsLoading(true)
        });

        expect(result.current.isLoading).toBe(true);

        // Resolve the action and let signIn finish
        await act(async () => {
          resolveAction(SUCCESS);
          await callPromise!;
        });

        expect(result.current.isLoading).toBe(false);
      });

      test("resets to false even when signInAction throws", async () => {
        mockSignInAction.mockRejectedValue(new Error("Network error"));

        const { result } = renderHook(() => useAuth());
        await act(async () => {
          try {
            await result.current.signIn("u@e.com", "pass");
          } catch {
            // signIn propagates the rejection — expected
          }
        });

        expect(result.current.isLoading).toBe(false);
      });
    });
  });

  // ── signUp ──────────────────────────────────────────────────────────────

  describe("signUp()", () => {
    describe("on success", () => {
      beforeEach(() => {
        mockSignUpAction.mockResolvedValue(SUCCESS);
      });

      test("navigates to most recent project when user has projects", async () => {
        mockGetProjects.mockResolvedValue([{ id: "first" }, { id: "second" }]);

        const { result } = renderHook(() => useAuth());
        await act(async () => {
          await result.current.signUp("new@user.com", "password123");
        });

        expect(mockPush).toHaveBeenCalledWith("/first");
      });

      test("creates a new project and navigates when user has no projects", async () => {
        mockGetProjects.mockResolvedValue([]);
        mockCreateProject.mockResolvedValue({ id: "fresh-project" });

        const { result } = renderHook(() => useAuth());
        await act(async () => {
          await result.current.signUp("new@user.com", "password123");
        });

        expect(mockCreateProject).toHaveBeenCalledWith(
          expect.objectContaining({ messages: [], data: {} })
        );
        expect(mockPush).toHaveBeenCalledWith("/fresh-project");
      });

      test("migrates anon work on sign-up", async () => {
        const anonWork = {
          messages: [{ role: "user", content: "Make a form" }],
          fileSystemData: { "/App.tsx": { content: "..." } },
        };
        mockGetAnonWorkData.mockReturnValue(anonWork);
        mockCreateProject.mockResolvedValue({ id: "signup-migrated" });

        const { result } = renderHook(() => useAuth());
        await act(async () => {
          await result.current.signUp("new@user.com", "password123");
        });

        expect(mockCreateProject).toHaveBeenCalledWith(
          expect.objectContaining({ messages: anonWork.messages, data: anonWork.fileSystemData })
        );
        expect(mockClearAnonWork).toHaveBeenCalledTimes(1);
        expect(mockPush).toHaveBeenCalledWith("/signup-migrated");
      });

      test("calls signUpAction with provided credentials", async () => {
        mockGetProjects.mockResolvedValue([{ id: "p" }]);

        const { result } = renderHook(() => useAuth());
        await act(async () => {
          await result.current.signUp("register@me.com", "securepass");
        });

        expect(mockSignUpAction).toHaveBeenCalledWith("register@me.com", "securepass");
      });

      test("returns the server action result", async () => {
        mockGetProjects.mockResolvedValue([{ id: "p" }]);

        const { result } = renderHook(() => useAuth());
        let returnValue: unknown;
        await act(async () => {
          returnValue = await result.current.signUp("u@test.com", "pass");
        });

        expect(returnValue).toEqual(SUCCESS);
      });
    });

    describe("on failure", () => {
      beforeEach(() => {
        mockSignUpAction.mockResolvedValue({ success: false, error: "Email already registered" });
      });

      test("does not navigate when sign-up fails", async () => {
        const { result } = renderHook(() => useAuth());
        await act(async () => {
          await result.current.signUp("taken@email.com", "password123");
        });

        expect(mockPush).not.toHaveBeenCalled();
      });

      test("returns the failure result", async () => {
        const { result } = renderHook(() => useAuth());
        let returnValue: unknown;
        await act(async () => {
          returnValue = await result.current.signUp("taken@email.com", "password123");
        });

        expect(returnValue).toEqual({ success: false, error: "Email already registered" });
      });
    });

    describe("isLoading", () => {
      test("is true during call and resets to false on success", async () => {
        let resolveAction!: (v: unknown) => void;
        mockSignUpAction.mockImplementation(
          () => new Promise((r) => { resolveAction = r; })
        );
        mockGetProjects.mockResolvedValue([{ id: "x" }]);

        const { result } = renderHook(() => useAuth());

        let callPromise: Promise<unknown>;
        await act(async () => {
          callPromise = result.current.signUp("u@e.com", "pass");
          await Promise.resolve();
        });

        expect(result.current.isLoading).toBe(true);

        await act(async () => {
          resolveAction(SUCCESS);
          await callPromise!;
        });

        expect(result.current.isLoading).toBe(false);
      });

      test("resets to false even when signUpAction throws", async () => {
        mockSignUpAction.mockRejectedValue(new Error("Server error"));

        const { result } = renderHook(() => useAuth());
        await act(async () => {
          try {
            await result.current.signUp("u@e.com", "pass");
          } catch {
            // signUp propagates the rejection — expected
          }
        });

        expect(result.current.isLoading).toBe(false);
      });
    });
  });
});
