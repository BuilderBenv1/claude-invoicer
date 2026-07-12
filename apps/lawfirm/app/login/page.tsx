import { signIn } from '@/lib/auth';

export default function LoginPage() {
  return (
    <div className="min-h-[70vh] grid place-items-center">
      <div className="card w-full max-w-sm text-center">
        <h1 className="text-xl font-semibold mb-1">ניהול שעות ומשרד</h1>
        <p className="text-sm text-slate-400 mb-6">מדידת זמן לפי לקוח · תיק · משימה</p>
        <form
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: '/' });
          }}
        >
          <button className="btn-primary w-full" type="submit">
            התחברות עם Google
          </button>
        </form>
      </div>
    </div>
  );
}
