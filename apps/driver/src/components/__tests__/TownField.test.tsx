import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { TownField } from '../TownField';
import { searchTowns } from '../../data/towns';

describe('searchTowns', () => {
  it('finds a town the way people type it', () => {
    expect(searchTowns('st aug')[0].name).toBe('Saint Augustine');
    expect(searchTowns('sipa')[0].name).toBe('Siparia');
    expect(searchTowns('a')).toEqual([]);
    expect(searchTowns('zzqq')).toEqual([]);
  });
});

describe('TownField', () => {
  it('picks a town with its position, and clears it when edited', () => {
    const onChange = jest.fn();
    const { getByLabelText, getByText, rerender } = render(<TownField value={null} onChange={onChange} />);
    fireEvent.changeText(getByLabelText('Home town'), 'mara');
    fireEvent.press(getByText('Marabella'));
    const picked = onChange.mock.calls[0][0];
    expect(picked).toMatchObject({ name: 'Marabella', lat: 10.307, lng: -61.452 });

    rerender(<TownField value={picked} onChange={onChange} />);
    fireEvent.changeText(getByLabelText('Home town'), 'Marabel');
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('says so when nothing matches', () => {
    const { getByLabelText, getByText } = render(<TownField value={null} onChange={jest.fn()} />);
    fireEvent.changeText(getByLabelText('Home town'), 'zzqq');
    expect(getByText(/closest town/)).toBeTruthy();
  });
});
