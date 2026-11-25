const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_URL?.trim();

if (!configuredApiBaseUrl && process.env.NODE_ENV === "production") {
  throw new Error(
    "Missing required environment variable NEXT_PUBLIC_API_URL. Set it to the deployed backend URL before building the frontend.",
  );
}

export const apiBaseUrl = (configuredApiBaseUrl || "http://localhost:4000").replace(/\/+$/, "");
