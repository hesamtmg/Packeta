import { ConflictException } from '@nestjs/common';
import { WalletTypesService } from './wallet-types.service';

function buildService(options: { walletCount: number }) {
  const type = { id: 'type-1', name: 'Rewards' };
  const walletTypesRepository = {
    findOne: jest.fn(async () => type),
    delete: jest.fn(async () => undefined),
  };
  const walletsRepository = {
    count: jest.fn(async () => options.walletCount),
  };
  const currenciesService = {};
  const service = new WalletTypesService(
    walletTypesRepository as any,
    walletsRepository as any,
    currenciesService as any,
  );
  return { service, walletTypesRepository, walletsRepository };
}

describe('WalletTypesService.delete', () => {
  it('rejects deleting a wallet type that is still in use', async () => {
    const { service, walletTypesRepository } = buildService({
      walletCount: 3,
    });

    await expect(service.delete('type-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(walletTypesRepository.delete).not.toHaveBeenCalled();
  });

  it('deletes a wallet type that no wallet uses', async () => {
    const { service, walletTypesRepository } = buildService({
      walletCount: 0,
    });

    await service.delete('type-1');

    expect(walletTypesRepository.delete).toHaveBeenCalledWith('type-1');
  });
});
