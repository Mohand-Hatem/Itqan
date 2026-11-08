import { TenantSlugSchema } from "@itqan/shared";

export default function HomePage() {
  const sampleSlug = "itqan-demo";
  const isValidSlug = TenantSlugSchema.safeParse(sampleSlug).success;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-xl text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">
          إتقان | Itqan LMS
        </h1>
        <p className="text-lg text-slate-600">
          منصة تعليمية متكاملة متعددة المستأجرين
        </p>
        <div className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-emerald-100 text-emerald-800">
          Phase 1: Foundation Scaffold Active
        </div>
        {isValidSlug && (
          <p className="text-xs text-slate-400">
            Tenant validation active via @itqan/shared ({sampleSlug})
          </p>
        )}
      </div>
    </main>
  );
}
