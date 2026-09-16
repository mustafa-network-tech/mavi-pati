type Environment = {
  NODE_ENV?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
};
export function isLocalDemo(environment: Environment = process.env) {
  return (
    environment.NODE_ENV === "development" &&
    !environment.NEXT_PUBLIC_SUPABASE_URL &&
    !environment.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
