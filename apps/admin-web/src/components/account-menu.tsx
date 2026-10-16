"use client";

import Link from "next/link";
import { KeyRoundIcon, LogOutIcon } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@platform/ui";
import type { CurrentUser } from "./app-shell";
import type { Dictionary } from "@/messages/en";

/**
 * The topbar avatar, as a menu: who is signed in (email + role) and the way out. `user.name` is
 * the identity's email — see `getCurrentUser`.
 *
 * The sign-out item wraps a plain `<a href="/logout">` and never a `next/link` `<Link>`: Link
 * prefetches, and prefetching `/logout` would end the session by itself.
 */
export function AccountMenu({ t, user }: { readonly t: Dictionary; readonly user: CurrentUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t.topbar.account}
          className="ms-1 rounded-full"
        >
          <Avatar className="size-8">
            <AvatarFallback>{user.initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
          <span className="text-foreground truncate font-medium" dir="auto">
            {user.name}
          </span>
          <span className="text-muted-foreground truncate text-xs">{user.role}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {user.canChangePassword === true && (
          <DropdownMenuItem asChild>
            <Link href="/account/password">
              <KeyRoundIcon aria-hidden="true" />
              {t.topbar.changePassword}
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <a href="/logout">
            <LogOutIcon aria-hidden="true" className="rtl:-scale-x-100" />
            {t.topbar.signOut}
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
