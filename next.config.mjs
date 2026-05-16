/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Ensure the SQL migration files travel with the serverless bundle for
  // /api/migrate, which reads them at runtime.
  outputFileTracingIncludes: {
    "/api/migrate": ["./supabase/migrations/**/*.sql"],
  },
};

export default nextConfig;
