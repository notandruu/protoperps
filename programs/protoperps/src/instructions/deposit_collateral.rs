use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::errors::ProtoperpsError;
use crate::events::CollateralDeposited;
use crate::state::{MarginAccount, MARGIN_ACCOUNT_SPACE};

#[derive(Accounts)]
pub struct DepositCollateral<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    /// MarginAccount PDA for this trader.
    /// Created on first deposit (init_if_needed).
    #[account(
        init_if_needed,
        payer = owner,
        space = MARGIN_ACCOUNT_SPACE,
        seeds = [b"margin", owner.key().as_ref()],
        bump,
    )]
    pub margin_account: Account<'info, MarginAccount>,

    /// Trader's USDC token account (source of funds).
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = owner,
    )]
    pub user_usdc: Account<'info, TokenAccount>,

    /// CHECK: PDA that acts as the authority for the program vault.
    /// Address verified by seeds; no on-chain data required.
    #[account(seeds = [b"vault"], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    /// Program USDC vault — ATA of vault_authority.
    /// Created on first deposit (init_if_needed).
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault_authority,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn deposit_collateral(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
    // ── validate ──────────────────────────────────────────────────────────────
    require!(amount > 0, ProtoperpsError::AmountZero);

    // ── mutate ────────────────────────────────────────────────────────────────
    let margin_account = &mut ctx.accounts.margin_account;

    // Initialize owner/bump on first deposit (zeroed on account creation).
    if margin_account.owner == Pubkey::default() {
        margin_account.bump = ctx.bumps.margin_account;
        margin_account.owner = ctx.accounts.owner.key();
    }

    margin_account.usdc_deposited = margin_account
        .usdc_deposited
        .checked_add(amount)
        .ok_or(ProtoperpsError::MathOverflow)?;

    let total_deposited = margin_account.usdc_deposited;

    // ── CPI: transfer USDC owner → vault ─────────────────────────────────────
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.user_usdc.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
    )?;

    // ── emit ──────────────────────────────────────────────────────────────────
    emit!(CollateralDeposited {
        owner: ctx.accounts.owner.key(),
        amount,
        total_deposited,
    });

    Ok(())
}
