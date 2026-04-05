use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, MintTo, Transfer};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("EnergyTokenProgramID11111111111111111111111");

#[program]
pub mod energy_token {
    use super::*;

    /// Initialize the marketplace and create the kWh SPL token mint
    pub fn initialize_marketplace(
        ctx: Context<InitializeMarketplace>,
        token_price_lamports: u64, // price per token in lamports (e.g. 10_000_000 = 0.01 SOL)
    ) -> Result<()> {
        let marketplace = &mut ctx.accounts.marketplace;
        marketplace.authority = ctx.accounts.authority.key();
        marketplace.mint = ctx.accounts.mint.key();
        marketplace.token_price_lamports = token_price_lamports;
        marketplace.total_minted = 0;
        marketplace.total_traded = 0;
        marketplace.bump = ctx.bumps.marketplace;
        msg!("EnergyToken marketplace initialized. Price: {} lamports/kWh", token_price_lamports);
        Ok(())
    }

    /// Producer mints energy tokens (1 token = 1 kWh)
    pub fn mint_energy_tokens(
        ctx: Context<MintEnergyTokens>,
        amount: u64, // number of kWh tokens to mint
    ) -> Result<()> {
        require!(amount > 0, EnergyError::InvalidAmount);
        require!(amount <= 10_000, EnergyError::AmountTooLarge); // safety cap

        let marketplace = &mut ctx.accounts.marketplace;
        let seeds = &[
            b"marketplace".as_ref(),
            marketplace.authority.as_ref(),
            &[marketplace.bump],
        ];
        let signer = &[&seeds[..]];

        // Mint tokens to the producer's token account
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.producer_token_account.to_account_info(),
                    authority: ctx.accounts.marketplace.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        marketplace.total_minted = marketplace.total_minted.checked_add(amount)
            .ok_or(EnergyError::Overflow)?;

        // Record producer registry entry
        let producer = &mut ctx.accounts.producer_registry;
        producer.wallet = ctx.accounts.producer.key();
        producer.total_minted = producer.total_minted.checked_add(amount)
            .ok_or(EnergyError::Overflow)?;
        producer.bump = ctx.bumps.producer_registry;

        emit!(EnergyMinted {
            producer: ctx.accounts.producer.key(),
            amount,
            total_minted: marketplace.total_minted,
        });

        msg!("Minted {} kWh tokens to producer {}", amount, ctx.accounts.producer.key());
        Ok(())
    }

    /// User buys energy tokens by paying SOL
    pub fn buy_tokens(
        ctx: Context<BuyTokens>,
        amount: u64, // number of tokens to buy
    ) -> Result<()> {
        require!(amount > 0, EnergyError::InvalidAmount);

        let marketplace = &ctx.accounts.marketplace;
        let total_cost = marketplace.token_price_lamports
            .checked_mul(amount)
            .ok_or(EnergyError::Overflow)?;

        // Check buyer has enough SOL
        require!(
            ctx.accounts.buyer.lamports() >= total_cost,
            EnergyError::InsufficientFunds
        );

        // Check marketplace has enough tokens
        require!(
            ctx.accounts.marketplace_token_account.amount >= amount,
            EnergyError::InsufficientTokens
        );

        // Transfer SOL from buyer to marketplace authority (treasury)
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.buyer.key(),
            &ctx.accounts.treasury.key(),
            total_cost,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.buyer.to_account_info(),
                ctx.accounts.treasury.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Transfer tokens from marketplace vault to buyer
        let seeds = &[
            b"marketplace".as_ref(),
            marketplace.authority.as_ref(),
            &[marketplace.bump],
        ];
        let signer = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.marketplace_token_account.to_account_info(),
                    to: ctx.accounts.buyer_token_account.to_account_info(),
                    authority: ctx.accounts.marketplace.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        let marketplace = &mut ctx.accounts.marketplace;
        marketplace.total_traded = marketplace.total_traded.checked_add(amount)
            .ok_or(EnergyError::Overflow)?;

        emit!(TokensPurchased {
            buyer: ctx.accounts.buyer.key(),
            amount,
            sol_paid: total_cost,
        });

        msg!("Buyer {} purchased {} kWh tokens for {} lamports", 
            ctx.accounts.buyer.key(), amount, total_cost);
        Ok(())
    }

    /// Transfer tokens from one user to another (peer-to-peer energy trading)
    pub fn transfer_tokens(
        ctx: Context<TransferTokens>,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, EnergyError::InvalidAmount);
        require!(
            ctx.accounts.from_token_account.amount >= amount,
            EnergyError::InsufficientTokens
        );

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.from_token_account.to_account_info(),
                    to: ctx.accounts.to_token_account.to_account_info(),
                    authority: ctx.accounts.from.to_account_info(),
                },
            ),
            amount,
        )?;

        emit!(TokensTransferred {
            from: ctx.accounts.from.key(),
            to: ctx.accounts.to.key(),
            amount,
        });

        msg!("Transferred {} kWh tokens from {} to {}", 
            amount, ctx.accounts.from.key(), ctx.accounts.to.key());
        Ok(())
    }

    /// Create a sell listing on the marketplace
    pub fn create_listing(
        ctx: Context<CreateListing>,
        amount: u64,
        price_per_token: u64, // in lamports
    ) -> Result<()> {
        require!(amount > 0, EnergyError::InvalidAmount);
        require!(price_per_token > 0, EnergyError::InvalidAmount);
        require!(
            ctx.accounts.seller_token_account.amount >= amount,
            EnergyError::InsufficientTokens
        );

        let listing = &mut ctx.accounts.listing;
        listing.seller = ctx.accounts.seller.key();
        listing.amount = amount;
        listing.price_per_token = price_per_token;
        listing.is_active = true;
        listing.bump = ctx.bumps.listing;

        // Lock tokens in escrow
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.seller_token_account.to_account_info(),
                    to: ctx.accounts.escrow_token_account.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            amount,
        )?;

        emit!(ListingCreated {
            seller: ctx.accounts.seller.key(),
            amount,
            price_per_token,
        });

        msg!("Listed {} kWh tokens at {} lamports/kWh", amount, price_per_token);
        Ok(())
    }

    /// Cancel an active listing and return tokens
    pub fn cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
        let listing = &mut ctx.accounts.listing;
        require!(listing.is_active, EnergyError::ListingNotActive);
        require!(
            listing.seller == ctx.accounts.seller.key(),
            EnergyError::Unauthorized
        );

        listing.is_active = false;

        let seeds = &[
            b"listing".as_ref(),
            ctx.accounts.seller.key().as_ref(),
            &[listing.bump],
        ];
        let signer = &[&seeds[..]];

        // Return tokens from escrow to seller
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    to: ctx.accounts.seller_token_account.to_account_info(),
                    authority: ctx.accounts.listing.to_account_info(),
                },
                signer,
            ),
            listing.amount,
        )?;

        msg!("Listing cancelled, {} tokens returned to seller", listing.amount);
        Ok(())
    }
}

// ===================== ACCOUNT STRUCTS =====================

#[account]
pub struct Marketplace {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub token_price_lamports: u64,
    pub total_minted: u64,
    pub total_traded: u64,
    pub bump: u8,
}

#[account]
pub struct ProducerRegistry {
    pub wallet: Pubkey,
    pub total_minted: u64,
    pub bump: u8,
}

#[account]
pub struct Listing {
    pub seller: Pubkey,
    pub amount: u64,
    pub price_per_token: u64,
    pub is_active: bool,
    pub bump: u8,
}

// ===================== CONTEXT STRUCTS =====================

#[derive(Accounts)]
pub struct InitializeMarketplace<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 8 + 8 + 8 + 1,
        seeds = [b"marketplace", authority.key().as_ref()],
        bump
    )]
    pub marketplace: Account<'info, Marketplace>,

    #[account(
        init,
        payer = authority,
        mint::decimals = 0, // 1 token = 1 kWh, no fractional kWh
        mint::authority = marketplace,
        mint::freeze_authority = marketplace,
    )]
    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct MintEnergyTokens<'info> {
    #[account(
        mut,
        seeds = [b"marketplace", marketplace.authority.as_ref()],
        bump = marketplace.bump
    )]
    pub marketplace: Account<'info, Marketplace>,

    #[account(
        mut,
        address = marketplace.mint
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = producer,
        associated_token::mint = mint,
        associated_token::authority = producer,
    )]
    pub producer_token_account: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = producer,
        space = 8 + 32 + 8 + 1,
        seeds = [b"producer", producer.key().as_ref()],
        bump
    )]
    pub producer_registry: Account<'info, ProducerRegistry>,

    #[account(mut)]
    pub producer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct BuyTokens<'info> {
    #[account(
        mut,
        seeds = [b"marketplace", marketplace.authority.as_ref()],
        bump = marketplace.bump
    )]
    pub marketplace: Account<'info, Marketplace>,

    #[account(mut)]
    pub marketplace_token_account: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer,
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    /// CHECK: Treasury is the marketplace authority's wallet
    #[account(mut, address = marketplace.authority)]
    pub treasury: AccountInfo<'info>,

    #[account(mut)]
    pub buyer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct TransferTokens<'info> {
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = from,
    )]
    pub from_token_account: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = from,
        associated_token::mint = mint,
        associated_token::authority = to,
    )]
    pub to_token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    /// CHECK: recipient wallet
    pub to: AccountInfo<'info>,

    #[account(mut)]
    pub from: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CreateListing<'info> {
    #[account(
        init,
        payer = seller,
        space = 8 + 32 + 8 + 8 + 1 + 1,
        seeds = [b"listing", seller.key().as_ref()],
        bump
    )]
    pub listing: Account<'info, Listing>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = seller,
    )]
    pub seller_token_account: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = seller,
        associated_token::mint = mint,
        associated_token::authority = listing,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub seller: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CancelListing<'info> {
    #[account(
        mut,
        seeds = [b"listing", seller.key().as_ref()],
        bump = listing.bump
    )]
    pub listing: Account<'info, Listing>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = listing,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = seller,
    )]
    pub seller_token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub seller: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ===================== EVENTS =====================

#[event]
pub struct EnergyMinted {
    pub producer: Pubkey,
    pub amount: u64,
    pub total_minted: u64,
}

#[event]
pub struct TokensPurchased {
    pub buyer: Pubkey,
    pub amount: u64,
    pub sol_paid: u64,
}

#[event]
pub struct TokensTransferred {
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ListingCreated {
    pub seller: Pubkey,
    pub amount: u64,
    pub price_per_token: u64,
}

// ===================== ERRORS =====================

#[error_code]
pub enum EnergyError {
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Amount exceeds maximum allowed per transaction")]
    AmountTooLarge,
    #[msg("Insufficient SOL balance to complete purchase")]
    InsufficientFunds,
    #[msg("Insufficient token balance")]
    InsufficientTokens,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Listing is not active")]
    ListingNotActive,
    #[msg("Unauthorized action")]
    Unauthorized,
}
