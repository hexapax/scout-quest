import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

if (ADMIN_EMAILS.length === 0) {
  console.warn("WARNING: ADMIN_EMAILS is empty — no one can log in");
}

export interface AdminUser {
  email: string;
  name: string;
}

export function isAllowedAdmin(email: string): boolean {
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

// Serialize the user object into the session
passport.serializeUser((user, done) => {
  done(null, user);
});

// Deserialize the user object from the session
passport.deserializeUser((user: AdminUser, done) => {
  done(null, user);
});

// Configure Google OAuth strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      callbackURL: process.env.GOOGLE_CALLBACK_URL || "/auth/google/callback",
    },
    (_accessToken, _refreshToken, profile, done) => {
      const email = profile.emails?.[0]?.value;
      if (!email) {
        return done(new Error("No email returned from Google"));
      }

      if (!isAllowedAdmin(email)) {
        return done(new Error(`Email ${email} is not authorized`));
      }

      const user: AdminUser = {
        email: email.toLowerCase(),
        name: profile.displayName || email,
      };
      return done(null, user);
    }
  )
);

export { passport };
