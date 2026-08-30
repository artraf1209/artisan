'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

type OrderType = 'market' | 'limit'

interface ClosePositionDialogProps {
  positionId: string
  symbol: string
  quantity: number
  currentPrice: number | null
  hasRestingOrders: boolean
}

const inputClassName =
  'w-full rounded-2xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring'

export default function ClosePositionDialog({
  positionId,
  symbol,
  quantity,
  currentPrice,
  hasRestingOrders,
}: ClosePositionDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [orderType, setOrderType] = useState<OrderType>('market')
  const [quantityInput, setQuantityInput] = useState(String(quantity))
  const [limitPriceInput, setLimitPriceInput] = useState(currentPrice != null ? String(currentPrice) : '')
  const [error, setError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [isPending, startTransition] = useTransition()

  const parsedQuantity = Number(quantityInput)
  const isQuantityValid = Number.isInteger(parsedQuantity) && parsedQuantity > 0 && parsedQuantity <= quantity
  const isPartial = isQuantityValid && parsedQuantity < quantity
  const remainder = quantity - (isQuantityValid ? parsedQuantity : quantity)
  const parsedLimitPrice = Number(limitPriceInput)
  const isLimitPriceValid = orderType === 'market' || (Number.isFinite(parsedLimitPrice) && parsedLimitPrice > 0)
  const canSubmit = isQuantityValid && isLimitPriceValid && !isPending

  function resetForm() {
    setOrderType('market')
    setQuantityInput(String(quantity))
    setLimitPriceInput(currentPrice != null ? String(currentPrice) : '')
    setError(null)
    setConfirmClose(false)
  }

  function submit() {
    setError(null)
    startTransition(async () => {
      try {
        const response = await fetch(`/api/positions/${positionId}/close`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_type: orderType,
            quantity: parsedQuantity,
            ...(orderType === 'limit' ? { limit_price: parsedLimitPrice } : {}),
          }),
        })
        const body = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(body?.error ?? 'Failed to close position.')
        }
        setOpen(false)
        resetForm()
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to close position.')
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isPending) {
          return
        }
        setOpen(nextOpen)
        if (!nextOpen) {
          resetForm()
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          Close position
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md border-border bg-card text-foreground">
        <DialogHeader>
          <DialogTitle>Close {symbol}</DialogTitle>
          <DialogDescription>
            Places a real order immediately, outside the approval queue. {quantity} shares currently open.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <span className="text-sm font-medium text-foreground">Order type</span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={orderType === 'market' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setOrderType('market')}
                disabled={isPending}
              >
                Market
              </Button>
              <Button
                type="button"
                variant={orderType === 'limit' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setOrderType('limit')}
                disabled={isPending}
              >
                Limit
              </Button>
            </div>
          </div>

          <label className="block space-y-2 text-sm text-foreground">
            <span className="font-medium">Quantity (max {quantity})</span>
            <input
              type="number"
              min={1}
              max={quantity}
              step={1}
              value={quantityInput}
              onChange={(event) => setQuantityInput(event.target.value)}
              disabled={isPending}
              className={inputClassName}
            />
          </label>

          {orderType === 'limit' && (
            <label className="block space-y-2 text-sm text-foreground">
              <span className="font-medium">Limit price</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={limitPriceInput}
                onChange={(event) => setLimitPriceInput(event.target.value)}
                disabled={isPending}
                className={inputClassName}
              />
            </label>
          )}

          {hasRestingOrders && (
            <p className="rounded-2xl border border-loss/35 bg-loss/8 px-3 py-2 text-xs leading-5 text-foreground">
              This will cancel the existing stop-loss/take-profit orders on this position.
              {isPartial && (
                <>
                  {' '}
                  You&apos;re closing part of this position — the remaining {remainder} share
                  {remainder === 1 ? '' : 's'} will have no automatic stop-loss or take-profit until you set new
                  ones.
                </>
              )}
            </p>
          )}
          {!hasRestingOrders && isPartial && (
            <p className="rounded-2xl border border-border bg-background/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
              You&apos;re closing part of this position — {remainder} share{remainder === 1 ? '' : 's'} will remain
              open.
            </p>
          )}

          {error && <p className="text-sm text-loss">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => (confirmClose ? submit() : setConfirmClose(true))}
            disabled={!canSubmit}
          >
            {isPending
              ? 'Closing...'
              : confirmClose
                ? `Confirm close · ${parsedQuantity} sh${orderType === 'limit' ? ` @ $${parsedLimitPrice.toFixed(2)}` : ' at market'}`
                : 'Review close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
