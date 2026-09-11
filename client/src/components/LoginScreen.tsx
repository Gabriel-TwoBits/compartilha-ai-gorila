import { type FormEvent, useState } from "react"
import { MAX_NICKNAME_LENGTH } from "@shared/protocol"
import { type LoginFailure, login } from "../api"
import { Download, hasDownload } from "./Download"

const FAILURE_MESSAGES: Record<LoginFailure, string> = {
  invalid_nickname: "Escolha um apelido válido.",
  invalid_password: "Senha errada.",
  unavailable: "Não deu para falar com o servidor. Tente de novo.",
}

type Props = {
  onLogin: (nickname: string) => void
}

export function LoginScreen({ onLogin }: Props) {
  const [nickname, setNickname] = useState("")
  const [password, setPassword] = useState("")
  const [failure, setFailure] = useState<LoginFailure | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setSubmitting(true)
    setFailure(null)

    const result = await login(nickname, password)
    if (result.ok) {
      onLogin(result.nickname)
      return
    }

    setFailure(result.reason)
    setSubmitting(false)
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-edge bg-surface-raised p-8 shadow-2xl"
      >
        <h1 className="mb-1 flex items-center gap-2.5 text-2xl font-semibold">
          <img src="/icon.png" alt="" className="size-8" />
          {/* The whole name is one flex item: loose, the row's gap opens inside it. */}
          <span>
            Compartilha<span className="text-accent">AíGorila</span>
          </span>
        </h1>
        <p className="mb-8 text-sm text-ink-muted">Entre na sala pra assistir ou transmitir.</p>

        <label className="mb-2 block text-xs font-medium tracking-wide text-ink-muted uppercase">
          Apelido
          <input
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            maxLength={MAX_NICKNAME_LENGTH}
            autoComplete="nickname"
            required
            className="mt-1 w-full rounded-lg border border-edge bg-surface px-3 py-2 text-base text-ink normal-case outline-none focus:border-accent"
          />
        </label>

        <label className="mb-6 block text-xs font-medium tracking-wide text-ink-muted uppercase">
          Senha da sala
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            className="mt-1 w-full rounded-lg border border-edge bg-surface px-3 py-2 text-base text-ink normal-case outline-none focus:border-accent"
          />
        </label>

        {failure !== null && (
          <p role="alert" className="mb-4 text-sm text-red-400">
            {FAILURE_MESSAGES[failure]}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-accent px-4 py-2.5 font-semibold text-accent-ink transition hover:brightness-110 disabled:opacity-50"
        >
          {submitting ? "Entrando…" : "Entrar"}
        </button>

        {/* The frame belongs here, not in the component: the room shows the same
            thing inside a panel that looks nothing like this card. */}
        {hasDownload() && (
          <div className="mt-6 border-t border-edge pt-5">
            <Download />
          </div>
        )}
      </form>
    </div>
  )
}
