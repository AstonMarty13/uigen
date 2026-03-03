import { describe, test, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Mock server-only as no-op
vi.mock("server-only", () => ({}));

// Mock jose
const mockSign = vi.fn().mockResolvedValue("mock-token");
const mockSetIssuedAt = vi.fn().mockReturnThis();
const mockSetExpirationTime = vi.fn().mockReturnThis();
const mockSetProtectedHeader = vi.fn().mockReturnThis();

class MockSignJWT {
  constructor(public payload: unknown) {}
  setProtectedHeader = mockSetProtectedHeader;
  setExpirationTime = mockSetExpirationTime;
  setIssuedAt = mockSetIssuedAt;
  sign = mockSign;
}

const mockJwtVerify = vi.fn();

vi.mock("jose", () => ({
  SignJWT: MockSignJWT,
  jwtVerify: mockJwtVerify,
}));

// Mock next/headers
const mockCookieStore = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
}));

// Import after mocks
const { createSession, getSession, deleteSession, verifySession } =
  await import("../auth");

const makeRequest = (token?: string) =>
  ({
    cookies: {
      get: (name: string) => (token && name === "auth-token" ? { value: token } : undefined),
    },
  }) as unknown as NextRequest;

describe("auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSign.mockResolvedValue("mock-token");
    mockSetProtectedHeader.mockReturnThis();
    mockSetExpirationTime.mockReturnThis();
    mockSetIssuedAt.mockReturnThis();
    mockCookieStore.get.mockReturnValue(undefined);
  });

  describe("createSession()", () => {
    test("builds JWT with correct payload and header", async () => {
      await createSession("user-1", "user@example.com");

      expect(mockSetProtectedHeader).toHaveBeenCalledWith({ alg: "HS256" });
      expect(mockSetExpirationTime).toHaveBeenCalledWith("7d");
      expect(mockSetIssuedAt).toHaveBeenCalled();
      expect(mockSign).toHaveBeenCalled();
    });

    test("passes userId and email in JWT payload", async () => {
      await createSession("user-1", "user@example.com");

      // The MockSignJWT receives the payload in its constructor; verify via set cookie
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        "auth-token",
        "mock-token",
        expect.objectContaining({
          httpOnly: true,
          sameSite: "lax",
          path: "/",
        })
      );
    });

    test("sets auth-token cookie with correct options", async () => {
      await createSession("user-42", "hello@test.com");

      expect(mockCookieStore.set).toHaveBeenCalledTimes(1);
      const [name, token, options] = mockCookieStore.set.mock.calls[0];
      expect(name).toBe("auth-token");
      expect(token).toBe("mock-token");
      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe("lax");
      expect(options.path).toBe("/");
      expect(options.expires).toBeInstanceOf(Date);
    });
  });

  describe("getSession()", () => {
    test("returns null when no cookie present", async () => {
      mockCookieStore.get.mockReturnValue(undefined);

      const result = await getSession();

      expect(result).toBeNull();
      expect(mockJwtVerify).not.toHaveBeenCalled();
    });

    test("returns SessionPayload when token is valid", async () => {
      const payload = {
        userId: "user-1",
        email: "user@example.com",
        expiresAt: new Date(),
      };
      mockCookieStore.get.mockReturnValue({ value: "valid-token" });
      mockJwtVerify.mockResolvedValue({ payload });

      const result = await getSession();

      expect(mockJwtVerify).toHaveBeenCalledWith("valid-token", expect.anything());
      expect(result).toEqual(payload);
    });

    test("returns null when jwtVerify throws", async () => {
      mockCookieStore.get.mockReturnValue({ value: "expired-token" });
      mockJwtVerify.mockRejectedValue(new Error("JWTExpired"));

      const result = await getSession();

      expect(result).toBeNull();
    });
  });

  describe("deleteSession()", () => {
    test("deletes the auth-token cookie", async () => {
      await deleteSession();

      expect(mockCookieStore.delete).toHaveBeenCalledTimes(1);
      expect(mockCookieStore.delete).toHaveBeenCalledWith("auth-token");
    });
  });

  describe("verifySession()", () => {
    test("returns null when request has no auth-token cookie", async () => {
      const request = makeRequest();

      const result = await verifySession(request);

      expect(result).toBeNull();
      expect(mockJwtVerify).not.toHaveBeenCalled();
    });

    test("returns SessionPayload when token is valid", async () => {
      const payload = {
        userId: "user-2",
        email: "other@example.com",
        expiresAt: new Date(),
      };
      mockJwtVerify.mockResolvedValue({ payload });
      const request = makeRequest("valid-request-token");

      const result = await verifySession(request);

      expect(mockJwtVerify).toHaveBeenCalledWith(
        "valid-request-token",
        expect.anything()
      );
      expect(result).toEqual(payload);
    });

    test("returns null when jwtVerify throws", async () => {
      mockJwtVerify.mockRejectedValue(new Error("JWTInvalid"));
      const request = makeRequest("bad-token");

      const result = await verifySession(request);

      expect(result).toBeNull();
    });
  });
});
