import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Setting } from '@/lib/types'

export function useSettings() {
  const [settingsArray, setSettingsArray] = useState<Setting[]>([])
  const [loading, setLoading] = useState(true)

  const fetchSettings = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('settings')
      .select('*')

    if (error) {
      console.error('Failed to fetch settings:', error.message)
      setLoading(false)
      return
    }

    setSettingsArray(data ?? [])
    setLoading(false)
  }, [])

  // Expose settings as a key-value map for easy lookup
  const settings = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of settingsArray) {
      map.set(s.key, s.value)
    }
    return map
  }, [settingsArray])

  const updateSetting = useCallback(
    async (key: string, value: string) => {
      // Upsert: insert if not exists, update if exists
      const { error } = await supabase
        .from('settings')
        .upsert({ key, value }, { onConflict: 'key' })

      if (error) {
        console.error('Failed to update setting:', error.message)
        throw new Error(`Failed to update setting: ${error.message}`)
      }

      await fetchSettings()
    },
    [fetchSettings]
  )

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  return {
    /** Key-value map of settings */
    settings,
    /** Raw settings array (for export) */
    settingsArray,
    loading,
    updateSetting,
    refetch: fetchSettings,
  }
}
