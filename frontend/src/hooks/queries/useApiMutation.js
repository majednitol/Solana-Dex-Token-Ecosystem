import { useMutation, useQueryClient } from '@tanstack/react-query'

async function apiPost(url, body, options = {}) {
  const { headers = {}, isFormData = false } = options
  const fetchOptions = {
    method: 'POST',
    body: isFormData ? body : JSON.stringify(body),
  }
  if (!isFormData) {
    fetchOptions.headers = { 'Content-Type': 'application/json', ...headers }
  } else {
    fetchOptions.headers = { ...headers }
  }
  const res = await fetch(url, fetchOptions)
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}))
    throw new Error(errData.error || errData.message || `API returned ${res.status}`)
  }
  return res.json()
}

async function apiPatch(url, body) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}))
    throw new Error(errData.error || errData.message || `API returned ${res.status}`)
  }
  return res.json()
}

export function useApiMutation(invalidateKeys = []) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ url, body, options }) => apiPost(url, body, options),
    onSuccess: () => {
      invalidateKeys.forEach(key => {
        queryClient.invalidateQueries({ queryKey: key })
      })
    },
  })
}

export function useApiPatchMutation(invalidateKeys = []) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ url, body }) => apiPatch(url, body),
    onSuccess: () => {
      invalidateKeys.forEach(key => {
        queryClient.invalidateQueries({ queryKey: key })
      })
    },
  })
}

export function useSendTransaction(invalidateKeys = []) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ signedTx, updateChannels, tradeMeta }) => {
      const body = { transaction: signedTx }
      if (updateChannels) body.updateChannels = updateChannels
      if (tradeMeta) body.tradeMeta = tradeMeta
      return apiPost('/api/send', body)
    },
    onSuccess: () => {
      invalidateKeys.forEach(key => {
        queryClient.invalidateQueries({ queryKey: key })
      })
    },
  })
}
