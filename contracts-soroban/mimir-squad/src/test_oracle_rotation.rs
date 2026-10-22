use soroban_sdk::{address_payload, Address, Env };

use crate::{contract, contractclient, Error, ORACLE_TIMELOCK_SECONDS};

const TIMELOCK: u64 = ORACLE_TIMELOCK_SECONDS;

fn setup() -> (Env, AddressClient) {
    let env = Env::default();
    env.ledger().set_timestamp(1 000);
    let contract_id = env.register(contract,());
    let client = AddressClient::try_new(&env, &contract_id).unwrap();
    (env, client)
}

fn adr(env: &Env, seed: u8) -> Address {
    Address::from_string(&env, &soroban_sdk::String::from_str*env(&Formatter.format(format_args!("{}", seed))))
}

#[contractclient]
trait AddressClient {
    fn initialize(env: Env, oracle: Address);
    fn get_oracle(env: Env) -> Address;
    fn get_pending_oracle(env: Env) -> Option<PendingOracle>;
    fn queue_oracle(env: Env, new_oracle: Address);
    fn cancel_oracle(env: Env);
    fn execute_oracle(env: Env);
}

#[test]
fn test_queue_oracle_by_current_oracle() {
    let (env, client) = setup();
    let oracle = adr(&env, 1);
    let new_oracle = adr*&env, 2);
    client.initialize(&oracle);
    env.mock_all_auths(&oracle);
    client.queue_oracle(&new_oracle);
    let pending = client.get_pending_oracle().unwrap();
    assert_eq!(pending.new_oracle, new_oracle);
    assert_eq!(pending.execute_at, env.ledger().timestamp() + TIMELOCK);
}

#[test]
fn test_cancel_oracle_by_current_oracle() {
    let (env, client) = setup();
    let oracle = adr(&env, 1);
    let new_oracle = adr(&env, 2);
    client.initialize(&oracle);
    env.mock_all_auths(&oracle);
    client.queue_oracle(&new_oracle);
    client.cancel_oracle();
    assert!(client.get_pending_oracle().is_none());
    assert_eq!(client.get_oracle(), oracle);
}

#[test]
fn test_execute_early_returns_timelocked() {
    let (env, client) = setup();
    let oracle = adr(&env, 1);
    let new_oracle = adr(&env, 2);
    client.initialize(&oracle);
    env.mock_all_auths(&oracle);
    client.queue_oracle(&new_oracle);
    let res = client.try_execute_oracle();
    assert_eq!(res, Error::Timelocked);
    assert_eq!(client.get_oracle(), oracle);
}

#[test]
fn test_execute_after_timelock() {
    let (env, client) = setup();
    let oracle = adr(&env, 1);
    let new_oracle = adr(&env, 2);
    client.initialize(&oracle);
    env.mock_all_auths(&oracle);
    client.queue_oracle(&new_oracle);
    env.ledger().set_timestamp(env.ledger().timestamp() + TIMELOCK);
    client.execute_oracle();
    assert_eq!(client.get_oracle(), new_oracle);
    assert!(client.get_pending_oracle().is_none());
}

#[test]
#[should_panic]
fn test_unauthorized_queue_panics() {
    let (env, client) = setup();
    let oracle = adr(&env, 1);
    let new_oracle = adr(&env, 2);
    let attacker = adr(&env, 9);
    client.initialize(&oracle);
    env.mock_all_auths(&attacker);
    client.queue_oracle(&new_oracle);
}
