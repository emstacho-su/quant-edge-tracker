import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthGate } from '@/components/auth/AuthGate'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function StrategyNewInner() {
  const navigate = useNavigate()
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [sport] = useState('mlb') // only mlb supported in slice 05-01
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (!SLUG_RE.test(slug)) {
      setError('Slug must be kebab-case (lowercase letters, digits, hyphens).')
      return
    }
    if (!name.trim()) {
      setError('Name is required.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/strategies', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, name, description, sport }),
      })
      const body = await res.json().catch(() => ({}) as Record<string, unknown>)
      if (!res.ok) {
        setError(
          (body && typeof body.error === 'string' ? body.error : null) ??
            `Request failed (${res.status})`,
        )
        return
      }
      const created = body as { id: string }
      navigate(`/strategies/${created.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create strategy.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New strategy</h1>
        <p className="text-sm text-muted-foreground">
          Creates a draft strategy and enqueues the skill-folder scaffold task.
        </p>
      </div>
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="slug">Slug</Label>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                placeholder="mlb-pick-analysis"
                autoComplete="off"
                required
              />
              <p className="text-xs text-muted-foreground">
                kebab-case — used as the folder name in <code>quant-edge-skills/</code>.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="MLB Pick Analysis"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="One paragraph for the dashboard + SDK routing."
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sport">Sport</Label>
              <Input id="sport" value={sport} disabled />
              <p className="text-xs text-muted-foreground">
                Slice 05-01 supports MLB only. More sports land in milestone 06+.
              </p>
            </div>
            {error && (
              <p className="text-sm text-red-400" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating…' : 'Create strategy'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default function StrategyNew() {
  return (
    <AuthGate
      title="Sign in to create a strategy"
      description="Strategy creation is a write operation."
    >
      <StrategyNewInner />
    </AuthGate>
  )
}
