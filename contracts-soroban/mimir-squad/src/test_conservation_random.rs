#![cfg(test)]
//! Seeded randomized lifecycle coverage for global escrow conservation.

extern crate std;

use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::Address;
use std::vec::Vec;

use crate::test_common::{Fixture, DEFAULT_DURATION};
use crate::types::{RESULT_CANCELLED, SIDE_A, SIDE_B};

const SEED: u64 = 0x471_c0de_2026;
const PARTICIPANT_COUNT: usize = 12;
const MARKET_COUNT: usize = 7;
const RANDOM_STEPS: usize = 320;

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        let mut value = self.0;
        value ^= value << 13;
        value ^= value >> 7;
        value ^= value << 17;
        self.0 = value;
        value
    }

    fn below(&mut self, upper: usize) -> usize {
        (self.next() % upper as u64) as usize
    }
}

fn assert_global_conservation(f: &Fixture, participants: &[Address], seed: u64, step: usize) {
    let client = f.client();
    let market_count = client.get_market_count();
    let mut liabilities = client.get_accrued_fees();

    for market_id in 1..=market_count {
        let market = client.get_market(&market_id);
        liabilities += if market.resolved {
            market.remaining_escrow
        } else {
            market.pool_a + market.pool_b
        };

        for participant in participants {
            liabilities += client.parked_payout(&market_id, &SIDE_A, participant);
            liabilities += client.parked_payout(&market_id, &SIDE_B, participant);
        }
    }

    assert_eq!(
        f.escrow_balance(),
        liabilities,
        "global escrow conservation failed: seed={seed:#x}, step={step}"
    );
}

fn random_position_operation(
    f: &Fixture,
    participants: &[Address],
    market_ids: &[u64],
    rng: &mut Rng,
    seed: u64,
    step: usize,
) {
    let market_id = market_ids[rng.below(market_ids.len())];
    let participant = &participants[rng.below(participants.len())];
    let side = if rng.below(2) == 0 { SIDE_A } else { SIDE_B };
    let current = f.client().get_deposit(&market_id, &side, participant);

    if rng.below(2) == 0 || current < 2 {
        let amount = (rng.below(100_000) + 1) as i128;
        f.client().deposit(participant, &market_id, &side, &amount);
    } else {
        // Keep every seeded position nonzero so each participant remains
        // eligible for settlement after the randomized withdrawals.
        let amount = (rng.below((current - 1) as usize) + 1) as i128;
        f.client()
            .withdraw_before_deadline(participant, &market_id, &side, &amount);
    }

    assert_global_conservation(f, participants, seed, step);
}

#[test]
fn randomized_operations_conserve_global_escrow() {
    let f = Fixture::new();
    let mut rng = Rng(SEED);
    let captain = f.user(0);
    let participants: Vec<Address> = (0..PARTICIPANT_COUNT)
        .map(|_| f.user(1_000_000_000_000))
        .collect();
    let mut step = 0;
    let mut market_ids = Vec::new();

    for _ in 0..MARKET_COUNT {
        let market_id = f.market(&captain, 500);
        market_ids.push(market_id);
        step += 1;
        assert_global_conservation(&f, &participants, SEED, step);
    }

    // Six markets start two-sided; the last starts one-sided and exercises the
    // permissionless deadline-to-refund transition.
    for market_id in &market_ids[..MARKET_COUNT - 1] {
        for participant in &participants {
            for side in [SIDE_A, SIDE_B] {
                let amount = (rng.below(100_000) + 1) as i128;
                f.client().deposit(participant, market_id, &side, &amount);
                step += 1;
                assert_global_conservation(&f, &participants, SEED, step);
            }
        }
    }
    for participant in &participants {
        let amount = (rng.below(100_000) + 1) as i128;
        f.client()
            .deposit(participant, &market_ids[MARKET_COUNT - 1], &SIDE_A, &amount);
        step += 1;
        assert_global_conservation(&f, &participants, SEED, step);
    }

    // Random deposits and partial withdrawals, including every participant and
    // side across multiple markets.
    for _ in 0..200 {
        step += 1;
        random_position_operation(
            &f,
            &participants,
            &market_ids[..MARKET_COUNT - 1],
            &mut rng,
            SEED,
            step,
        );
    }

    // Randomize which five markets are captain-cancelled before the deadline.
    let mut cancellation_order: Vec<u64> = market_ids[..MARKET_COUNT - 2].to_vec();
    for index in (1..cancellation_order.len()).rev() {
        let other = rng.below(index + 1);
        cancellation_order.swap(index, other);
    }
    for market_id in cancellation_order {
        f.client().cancel_market(&market_id);
        step += 1;
        assert_global_conservation(&f, &participants, SEED, step);
    }

    for _ in 0..(RANDOM_STEPS - 205) {
        step += 1;
        random_position_operation(
            &f,
            &participants,
            &market_ids[MARKET_COUNT - 2..MARKET_COUNT - 1],
            &mut rng,
            SEED,
            step,
        );
    }
    assert_eq!(
        step,
        RANDOM_STEPS + MARKET_COUNT + PARTICIPANT_COUNT * (2 * (MARKET_COUNT - 1) + 1),
        "unexpected operation count: seed={SEED:#x}, step={step}"
    );

    f.advance_to(f.now() + DEFAULT_DURATION);
    step += 1;
    assert_global_conservation(&f, &participants, SEED, step);

    // Resolve one two-sided market and refund the remaining one-sided market.
    let resolved_market = market_ids[MARKET_COUNT - 2];
    let result = if rng.below(2) == 0 { SIDE_A } else { SIDE_B };
    f.client().resolve(&resolved_market, &result);
    step += 1;
    assert_global_conservation(&f, &participants, SEED, step);

    let one_sided_market = market_ids[MARKET_COUNT - 1];
    f.client().transition_deadline(&one_sided_market);
    step += 1;
    assert_global_conservation(&f, &participants, SEED, step);

    let mut claims = Vec::new();
    for market_id in &market_ids {
        let market = f.client().get_market(market_id);
        for (side, pays) in [
            (
                SIDE_A,
                market.result == RESULT_CANCELLED || market.result == SIDE_A,
            ),
            (
                SIDE_B,
                market.result == RESULT_CANCELLED || market.result == SIDE_B,
            ),
        ] {
            if pays {
                for (participant_index, participant) in participants.iter().enumerate() {
                    let principal = f.client().get_deposit(market_id, &side, participant);
                    if principal > 0 {
                        claims.push((*market_id, side, participant_index, principal));
                    }
                }
            }
        }
    }
    for index in (1..claims.len()).rev() {
        let other = rng.below(index + 1);
        claims.swap(index, other);
    }

    let token = StellarAssetClient::new(&f.env, &f.token_id);
    let mut frozen = std::vec![false; PARTICIPANT_COUNT];
    for (participant_index, participant) in participants.iter().enumerate() {
        if participant_index == 0 || rng.below(4) == 0 {
            token.set_authorized(participant, &false);
            frozen[participant_index] = true;
            step += 1;
            assert_global_conservation(&f, &participants, SEED, step);
        }
    }

    let balances_before_claims: Vec<i128> = participants
        .iter()
        .map(|participant| f.token().balance(participant))
        .collect();
    let mut expected_payouts = std::vec![0i128; PARTICIPANT_COUNT];
    let mut claimed_principal = std::vec![0i128; PARTICIPANT_COUNT];

    for (market_id, side, participant_index, principal) in &claims {
        let participant = &participants[*participant_index];
        let payout = f.client().claim(participant, market_id, side);
        assert!(
            payout >= *principal,
            "claim returned less than principal: seed={SEED:#x}, step={step}, market={market_id}"
        );
        expected_payouts[*participant_index] += payout;
        claimed_principal[*participant_index] += principal;
        step += 1;
        assert_global_conservation(&f, &participants, SEED, step);
    }

    for (participant_index, participant) in participants.iter().enumerate() {
        assert!(
            expected_payouts[participant_index] >= claimed_principal[participant_index],
            "participant did not recover claimed principal: seed={SEED:#x}, step={step}, participant={participant_index}"
        );
        for (market_id, side, claim_participant_index, _) in &claims {
            if *claim_participant_index == participant_index {
                assert!(
                    f.client().has_claimed(market_id, side, participant),
                    "eligible position was not claimed: seed={SEED:#x}, step={step}, market={market_id}, participant={participant_index}"
                );
            }
        }
    }

    // Re-authorize frozen trustlines and retry every parked amount in shuffled
    // order; the global equation includes those liabilities until delivery.
    let mut parked = Vec::new();
    for (participant_index, participant) in participants.iter().enumerate() {
        if frozen[participant_index] {
            token.set_authorized(participant, &true);
            for market_id in &market_ids {
                for side in [SIDE_A, SIDE_B] {
                    if f.client().parked_payout(market_id, &side, participant) > 0 {
                        parked.push((*market_id, side, participant_index));
                    }
                }
            }
            step += 1;
            assert_global_conservation(&f, &participants, SEED, step);
        }
    }
    for index in (1..parked.len()).rev() {
        let other = rng.below(index + 1);
        parked.swap(index, other);
    }
    for (market_id, side, participant_index) in parked {
        let participant = &participants[participant_index];
        let amount = f.client().parked_payout(&market_id, &side, participant);
        assert_eq!(
            f.client()
                .claim_parked_payout(participant, &market_id, &side),
            amount,
            "parked payout was not recovered: seed={SEED:#x}, step={step}, market={market_id}, participant={participant_index}"
        );
        step += 1;
        assert_global_conservation(&f, &participants, SEED, step);
    }

    for (participant_index, participant) in participants.iter().enumerate() {
        assert_eq!(
            f.token().balance(participant),
            balances_before_claims[participant_index] + expected_payouts[participant_index],
            "participant payout balance mismatch: seed={SEED:#x}, step={step}, participant={participant_index}"
        );
    }

    let fees = f.client().get_accrued_fees();
    if fees > 0 {
        f.client().claim_fees();
        step += 1;
        assert_global_conservation(&f, &participants, SEED, step);
    }

    assert_eq!(
        f.client().get_accrued_fees(),
        0,
        "fees were not fully claimed: seed={SEED:#x}, step={step}"
    );
    assert_global_conservation(&f, &participants, SEED, step);
}
