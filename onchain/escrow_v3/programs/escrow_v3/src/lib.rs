use anchor_lang::prelude::*;
use anchor_lang::solana_program::{hash::hash, program::invoke, system_instruction};

declare_id!("HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C");

#[program]
pub mod escrow_v3 {
    use super::*;

    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        agent_id: String,
        amount: u64,
        description_hash: [u8; 32],
        deadline: i64,
        nonce: u64,
        min_verification_level: u8,
        require_born: bool,
    ) -> Result<()> {
        require!(amount > 0, EscrowError::ZeroAmount);
        require!(min_verification_level <= 5, EscrowError::InvalidTrustRequirement);

        let now = Clock::get()?.unix_timestamp;
        require!(deadline > now, EscrowError::DeadlinePassed);

        invoke(
            &system_instruction::transfer(&ctx.accounts.client.key(), &ctx.accounts.escrow.key(), amount),
            &[
                ctx.accounts.client.to_account_info(),
                ctx.accounts.escrow.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        let escrow = &mut ctx.accounts.escrow;
        escrow.client = ctx.accounts.client.key();
        escrow.agent = ctx.accounts.agent_wallet.key();
        escrow.agent_id_hash = hash(agent_id.as_bytes()).to_bytes();
        escrow.amount = amount;
        escrow.released_amount = 0;
        escrow.description_hash = description_hash;
        escrow.deadline = deadline;
        escrow.nonce = nonce;
        escrow.status = EscrowStatus::Active;
        escrow.min_verification_level = min_verification_level;
        escrow.require_born = require_born;
        escrow.created_at = now;
        escrow.arbiter = ctx.accounts.arbiter.key();
        escrow.work_hash = None;
        escrow.work_submitted_at = None;
        escrow.dispute_reason_hash = None;
        escrow.disputed_at = None;
        escrow.disputed_by = None;
        escrow.bump = ctx.bumps.escrow;

        emit!(EscrowCreated {
            escrow: escrow.key(),
            client: escrow.client,
            agent: escrow.agent,
            agent_id_hash: escrow.agent_id_hash,
            amount,
            nonce,
        });

        Ok(())
    }

    pub fn submit_work(ctx: Context<SubmitWork>, work_hash: [u8; 32]) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(escrow.status == EscrowStatus::Active, EscrowError::NotActive);
        require_keys_eq!(escrow.agent, ctx.accounts.agent.key(), EscrowError::WrongAgent);

        escrow.status = EscrowStatus::WorkSubmitted;
        escrow.work_hash = Some(work_hash);
        escrow.work_submitted_at = Some(Clock::get()?.unix_timestamp);

        emit!(WorkSubmitted {
            escrow: escrow.key(),
            agent: escrow.agent,
            work_hash,
        });

        Ok(())
    }

    pub fn release(ctx: Context<Release>) -> Result<()> {
        let remaining = releasable_amount(&ctx.accounts.escrow);
        require!(remaining > 0, EscrowError::NothingToRelease);
        transfer_from_escrow(
            &ctx.accounts.escrow.to_account_info(),
            &ctx.accounts.agent.to_account_info(),
            remaining,
        )?;

        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.status == EscrowStatus::Active || escrow.status == EscrowStatus::WorkSubmitted,
            EscrowError::NotReleasable
        );
        require_keys_eq!(escrow.client, ctx.accounts.client.key(), EscrowError::Unauthorized);
        require_keys_eq!(escrow.agent, ctx.accounts.agent.key(), EscrowError::WrongAgent);
        escrow.released_amount = escrow.amount;
        escrow.status = EscrowStatus::Released;

        emit!(EscrowReleased {
            escrow: escrow.key(),
            agent: escrow.agent,
            amount: remaining,
        });

        Ok(())
    }

    pub fn partial_release(ctx: Context<Release>, amount: u64) -> Result<()> {
        require!(amount > 0, EscrowError::ZeroAmount);

        let remaining = releasable_amount(&ctx.accounts.escrow);
        require!(amount <= remaining, EscrowError::AmountExceedsRemaining);
        transfer_from_escrow(
            &ctx.accounts.escrow.to_account_info(),
            &ctx.accounts.agent.to_account_info(),
            amount,
        )?;

        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.status == EscrowStatus::Active || escrow.status == EscrowStatus::WorkSubmitted,
            EscrowError::NotReleasable
        );
        require_keys_eq!(escrow.client, ctx.accounts.client.key(), EscrowError::Unauthorized);
        require_keys_eq!(escrow.agent, ctx.accounts.agent.key(), EscrowError::WrongAgent);
        escrow.released_amount = escrow.released_amount.saturating_add(amount);
        if escrow.released_amount == escrow.amount {
            escrow.status = EscrowStatus::Released;
        }

        emit!(EscrowPartiallyReleased {
            escrow: escrow.key(),
            agent: escrow.agent,
            amount,
            remaining: escrow.amount.saturating_sub(escrow.released_amount),
        });

        Ok(())
    }

    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require_keys_eq!(escrow.client, ctx.accounts.client.key(), EscrowError::Unauthorized);
        require!(escrow.status == EscrowStatus::Active, EscrowError::NotCancellable);
        require!(Clock::get()?.unix_timestamp >= escrow.deadline, EscrowError::DeadlineNotReached);

        let refund = escrow.amount.saturating_sub(escrow.released_amount);
        transfer_from_escrow(&escrow.to_account_info(), &ctx.accounts.client.to_account_info(), refund)?;
        escrow.status = EscrowStatus::Cancelled;

        emit!(EscrowCancelled {
            escrow: escrow.key(),
            client: escrow.client,
            amount: refund,
        });

        Ok(())
    }

    pub fn raise_dispute(ctx: Context<RaiseDispute>, reason_hash: [u8; 32]) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let signer = ctx.accounts.signer.key();
        require!(
            signer == escrow.client || signer == escrow.agent,
            EscrowError::Unauthorized
        );
        require!(
            escrow.status == EscrowStatus::Active || escrow.status == EscrowStatus::WorkSubmitted,
            EscrowError::NotDisputable
        );

        escrow.status = EscrowStatus::Disputed;
        escrow.dispute_reason_hash = Some(reason_hash);
        escrow.disputed_at = Some(Clock::get()?.unix_timestamp);
        escrow.disputed_by = Some(signer);

        emit!(DisputeRaised {
            escrow: escrow.key(),
            signer,
            reason_hash,
        });

        Ok(())
    }

    pub fn resolve_dispute(ctx: Context<ResolveDispute>, agent_amount: u64, client_amount: u64) -> Result<()> {
        let total = agent_amount
            .checked_add(client_amount)
            .ok_or(EscrowError::AmountExceedsRemaining)?;
        let remaining = ctx.accounts.escrow.amount.saturating_sub(ctx.accounts.escrow.released_amount);

        require!(ctx.accounts.escrow.status == EscrowStatus::Disputed, EscrowError::NotDisputed);
        require_keys_eq!(ctx.accounts.escrow.arbiter, ctx.accounts.arbiter.key(), EscrowError::Unauthorized);
        require!(total <= remaining, EscrowError::AmountExceedsRemaining);

        transfer_from_escrow(
            &ctx.accounts.escrow.to_account_info(),
            &ctx.accounts.agent.to_account_info(),
            agent_amount,
        )?;
        transfer_from_escrow(
            &ctx.accounts.escrow.to_account_info(),
            &ctx.accounts.client.to_account_info(),
            client_amount,
        )?;

        let escrow = &mut ctx.accounts.escrow;
        escrow.released_amount = escrow.released_amount.saturating_add(total);
        escrow.status = EscrowStatus::Resolved;

        emit!(DisputeResolved {
            escrow: escrow.key(),
            arbiter: ctx.accounts.arbiter.key(),
            agent_amount,
            client_amount,
        });

        Ok(())
    }

    pub fn extend_deadline(ctx: Context<ExtendDeadline>, new_deadline: i64) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require_keys_eq!(escrow.client, ctx.accounts.client.key(), EscrowError::Unauthorized);
        require!(escrow.status == EscrowStatus::Active, EscrowError::NotActive);
        require!(new_deadline > escrow.deadline, EscrowError::DeadlineNotExtended);

        escrow.deadline = new_deadline;

        emit!(DeadlineExtended {
            escrow: escrow.key(),
            client: escrow.client,
            new_deadline,
        });

        Ok(())
    }

    pub fn close_escrow(ctx: Context<CloseEscrow>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require_keys_eq!(escrow.client, ctx.accounts.client.key(), EscrowError::Unauthorized);
        require!(
            escrow.status == EscrowStatus::Released
                || escrow.status == EscrowStatus::Cancelled
                || escrow.status == EscrowStatus::Resolved,
            EscrowError::NotCloseable
        );

        Ok(())
    }
}

fn releasable_amount(escrow: &Account<EscrowV3>) -> u64 {
    escrow.amount.saturating_sub(escrow.released_amount)
}

fn transfer_from_escrow<'info>(
    escrow: &AccountInfo<'info>,
    recipient: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    escrow.sub_lamports(amount)?;
    recipient.add_lamports(amount)?;
    Ok(())
}

#[derive(Accounts)]
#[instruction(agent_id: String, amount: u64, description_hash: [u8; 32], deadline: i64, nonce: u64)]
pub struct CreateEscrow<'info> {
    #[account(mut)]
    pub client: Signer<'info>,
    /// CHECK: Agent payout wallet is validated by the SATP identity layer before writes are enabled.
    pub agent_wallet: UncheckedAccount<'info>,
    /// CHECK: SATP V3 identity PDA is passed for runtime identity verification/audit.
    pub agent_identity: UncheckedAccount<'info>,
    /// CHECK: Arbiter wallet only signs during dispute resolution.
    pub arbiter: UncheckedAccount<'info>,
    #[account(
        init,
        payer = client,
        space = 8 + EscrowV3::LEN,
        seeds = [b"escrow_v3", client.key().as_ref(), &description_hash, &nonce.to_le_bytes()],
        bump
    )]
    pub escrow: Account<'info, EscrowV3>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitWork<'info> {
    #[account(mut)]
    pub escrow: Account<'info, EscrowV3>,
    pub agent: Signer<'info>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    #[account(mut)]
    pub escrow: Account<'info, EscrowV3>,
    pub client: Signer<'info>,
    /// CHECK: Lamport recipient must match escrow.agent.
    #[account(mut)]
    pub agent: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(mut)]
    pub escrow: Account<'info, EscrowV3>,
    #[account(mut)]
    pub client: Signer<'info>,
}

#[derive(Accounts)]
pub struct RaiseDispute<'info> {
    #[account(mut)]
    pub escrow: Account<'info, EscrowV3>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(mut)]
    pub escrow: Account<'info, EscrowV3>,
    pub arbiter: Signer<'info>,
    /// CHECK: Lamport recipient must match escrow.agent.
    #[account(mut)]
    pub agent: UncheckedAccount<'info>,
    /// CHECK: Lamport recipient must match escrow.client.
    #[account(mut)]
    pub client: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ExtendDeadline<'info> {
    #[account(mut)]
    pub escrow: Account<'info, EscrowV3>,
    pub client: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseEscrow<'info> {
    #[account(mut, close = client)]
    pub escrow: Account<'info, EscrowV3>,
    #[account(mut)]
    pub client: Signer<'info>,
}

#[account]
pub struct EscrowV3 {
    pub client: Pubkey,
    pub agent: Pubkey,
    pub agent_id_hash: [u8; 32],
    pub amount: u64,
    pub released_amount: u64,
    pub description_hash: [u8; 32],
    pub deadline: i64,
    pub nonce: u64,
    pub status: EscrowStatus,
    pub min_verification_level: u8,
    pub require_born: bool,
    pub created_at: i64,
    pub arbiter: Pubkey,
    pub work_hash: Option<[u8; 32]>,
    pub work_submitted_at: Option<i64>,
    pub dispute_reason_hash: Option<[u8; 32]>,
    pub disputed_at: Option<i64>,
    pub disputed_by: Option<Pubkey>,
    pub bump: u8,
}

impl EscrowV3 {
    pub const LEN: usize = 321;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum EscrowStatus {
    Active,
    WorkSubmitted,
    Released,
    Cancelled,
    Disputed,
    Resolved,
}

#[event]
pub struct EscrowCreated {
    pub escrow: Pubkey,
    pub client: Pubkey,
    pub agent: Pubkey,
    pub agent_id_hash: [u8; 32],
    pub amount: u64,
    pub nonce: u64,
}

#[event]
pub struct WorkSubmitted {
    pub escrow: Pubkey,
    pub agent: Pubkey,
    pub work_hash: [u8; 32],
}

#[event]
pub struct EscrowReleased {
    pub escrow: Pubkey,
    pub agent: Pubkey,
    pub amount: u64,
}

#[event]
pub struct EscrowPartiallyReleased {
    pub escrow: Pubkey,
    pub agent: Pubkey,
    pub amount: u64,
    pub remaining: u64,
}

#[event]
pub struct EscrowCancelled {
    pub escrow: Pubkey,
    pub client: Pubkey,
    pub amount: u64,
}

#[event]
pub struct DisputeRaised {
    pub escrow: Pubkey,
    pub signer: Pubkey,
    pub reason_hash: [u8; 32],
}

#[event]
pub struct DisputeResolved {
    pub escrow: Pubkey,
    pub arbiter: Pubkey,
    pub agent_amount: u64,
    pub client_amount: u64,
}

#[event]
pub struct DeadlineExtended {
    pub escrow: Pubkey,
    pub client: Pubkey,
    pub new_deadline: i64,
}

#[error_code]
pub enum EscrowError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Deadline has already passed")]
    DeadlinePassed,
    #[msg("Escrow is not active")]
    NotActive,
    #[msg("Escrow cannot be released")]
    NotReleasable,
    #[msg("Escrow cannot be cancelled")]
    NotCancellable,
    #[msg("Escrow cannot be disputed")]
    NotDisputable,
    #[msg("Escrow is not disputed")]
    NotDisputed,
    #[msg("Escrow cannot be closed")]
    NotCloseable,
    #[msg("Unauthorized signer")]
    Unauthorized,
    #[msg("Wrong agent wallet")]
    WrongAgent,
    #[msg("Deadline has not been reached")]
    DeadlineNotReached,
    #[msg("New deadline must extend the current deadline")]
    DeadlineNotExtended,
    #[msg("Amount exceeds remaining escrow balance")]
    AmountExceedsRemaining,
    #[msg("No releasable balance remains")]
    NothingToRelease,
    #[msg("Invalid trust requirement")]
    InvalidTrustRequirement,
}
