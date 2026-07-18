import { Link } from "@tanstack/react-router";
import {
	ArrowLeft,
	CheckCircle2,
	LoaderCircle,
	ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";

interface CompletionShellProps {
	readonly action: string;
	readonly children?: ReactNode;
	readonly description: string;
	readonly error?: string;
	readonly isPending: boolean;
	readonly isReady: boolean;
	readonly onSubmit: () => void;
	readonly success?: string;
	readonly title: string;
}

export function CompletionShell({
	action,
	children,
	description,
	error,
	isPending,
	isReady,
	onSubmit,
	success,
	title,
}: CompletionShellProps) {
	return (
		<main className="min-h-screen px-4 py-10 sm:py-16">
			<div className="mx-auto w-full max-w-lg">
				<Link
					to="/"
					className="mb-6 inline-flex items-center gap-2 text-sm font-semibold no-underline"
				>
					<ArrowLeft size={16} /> Back to sign in
				</Link>
				<section className="island-shell rounded-[2rem] p-7 sm:p-10">
					<div className="mb-7 flex size-12 items-center justify-center rounded-2xl bg-[var(--sea-ink)] text-white shadow-lg">
						<ShieldCheck size={24} />
					</div>
					<p className="island-kicker">Secure handoff</p>
					<h1 className="display-title mt-3 text-4xl font-bold tracking-tight">
						{title}
					</h1>
					<p className="mt-4 leading-7 text-[var(--sea-ink-soft)]">
						{description}
					</p>

					<div className="mt-8 space-y-5">
						{children}
						{error ? (
							<p className="rounded-xl border border-red-300/60 bg-red-50/80 px-4 py-3 text-sm text-red-800">
								{error}
							</p>
						) : null}
						{success ? (
							<p className="flex items-center gap-2 rounded-xl border border-emerald-300/60 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-900">
								<CheckCircle2 size={17} /> {success}
							</p>
						) : null}
						<button
							type="button"
							disabled={!isReady || isPending || Boolean(success)}
							onClick={onSubmit}
							className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--sea-ink)] px-5 py-3.5 font-bold text-white shadow-lg transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{isPending ? (
								<LoaderCircle className="animate-spin" size={18} />
							) : null}
							{action}
						</button>
					</div>
				</section>
			</div>
		</main>
	);
}
