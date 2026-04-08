use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::errors::ProtoperpsError;
use crate::events::CollateralWithdrawn;
use crate::state::MarginAccount;

#[derive(Accounts)]
pub struct WithdrawCollateral<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    /// MarginAccount for this trader — must already exist.
    #[account(
        mut,
        seeds = [b"margin", owner.key().as_ref()],
        bump = margin_account.bump,
        has_one = owner,
    )]
    pub margin_account: Account<'info, MarginAccount>,

    /// Trader's USDC token account (destination for withdrawal).
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = owner,
    )]
    pub user_usdc: Account<'info, TokenAccount>,

    /// CHECK: PDA vault authority — signs for vault → user transfer.
    /// Address verified by seeds.
    #[account(seeds = [b"vault"], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    /// Program USDC vault — ATA of vault_authority (source of funds).
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault_authority,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn withdraw_collateral(ctx: Context<WithdrawCollateral>, amount: u64) -> Result<()> {
    // ── validate ──────────────────────────────────────────────────────────────
    require!(amount > 0, ProtoperpsError::AmountZero);
    require!(
        ctx.accounts.margin_account.free_collateral() >= amount,
        ProtoperpsError::InsufficientFreeCollateral
    );

    // ── mutate ────────────────────────────────────────────────────────────────
    let margin_account = &mut ctx.accounts.margin_account;
    margin_account.usdc_deposited = margin_account
        .usdc_deposited
        .checked_sub(amount)
        .ok_or(ProtoperpsError::MathOverflow)?;

    let total_deposited = margin_account.usdc_deposited;
    let vault_bump = ctx.bumps.vault_authority;

    // ── CPI: transfer USDC vault → owner (PDA-signed) ─────────────────────────
    let seeds: &[&[u8]] = &[b"vault", &[vault_bump]];
    let signer_seeds = &[seeds];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user_usdc.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    // ── emit ──────────────────────────────────────────────────────────────────
    emit!(CollateralWithdrawn {
        owner: ctx.accounts.owner.key(),
        amount,
        total_deposited,
    });

    Ok(())
}
