import jwt from "jsonwebtoken";
import { env } from "../bootstrap/env.js";
import { httpError } from "./error.js";

type TokenType = "access" | "refresh";

export interface AccessTokenPayload {
  sub: string;
  jti: string;
  type: "access";
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  type: "refresh";
}

export const signAccessToken = (userId: string, jti: string): string =>
  jwt.sign({ sub: userId, jti, type: "access" }, env.jwtAccessSecret, {
    expiresIn: env.jwtAccessExpiresIn as jwt.SignOptions["expiresIn"],
  });

export const signRefreshToken = (userId: string, jti: string): string =>
  jwt.sign({ sub: userId, jti, type: "refresh" }, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiresIn as jwt.SignOptions["expiresIn"],
  });

const verify = (token: string, secret: string, expectedType: TokenType): { sub: string; jti: string } => {
  let decoded: string | jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, secret);
  } catch {
    throw httpError(401, "Invalid or expired token");
  }

  if (
    typeof decoded === "string" ||
    decoded.type !== expectedType ||
    typeof decoded.sub !== "string" ||
    typeof decoded.jti !== "string"
  ) {
    throw httpError(401, "Invalid token payload");
  }

  return { sub: decoded.sub, jti: decoded.jti };
};

export const verifyAccessToken = (token: string): AccessTokenPayload => {
  const { sub, jti } = verify(token, env.jwtAccessSecret, "access");
  return { sub, jti, type: "access" };
};

export const verifyRefreshToken = (token: string): RefreshTokenPayload => {
  const { sub, jti } = verify(token, env.jwtRefreshSecret, "refresh");
  return { sub, jti, type: "refresh" };
};

// reads back the exp jsonwebtoken just embedded, instead of re-parsing "7d"/"6h" by hand
export const getExpiry = (token: string): Date => {
  const decoded = jwt.decode(token) as jwt.JwtPayload | null;
  if (!decoded?.exp) throw httpError(500, "Signed token is missing an exp claim");
  return new Date(decoded.exp * 1000);
};
