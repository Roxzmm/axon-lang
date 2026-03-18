#include <stdio.h>
#include <time.h>

int main() {
    clock_t start = clock();
    
    long long sum = 0;
    for (int i = 0; i < 10000000; i++) {
        sum += i;
    }
    
    clock_t end = clock();
    double time = (double)(end - start) / CLOCKS_PER_SEC;
    
    printf("C Loop sum = %lld\n", sum);
    printf("Time: %.3f seconds\n", time);
    
    return 0;
}
